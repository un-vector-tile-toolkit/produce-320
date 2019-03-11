const config = require('config')
const Queue = require('better-queue')
const { spawn } = require('child_process')
const tilebelt = require('@mapbox/tilebelt')
const fs = require('fs')
const path = require('path')
const TimeFormat = require('hh-mm-ss')
const modify = require(config.get('modifyPath'))
const winston = require('winston')
const tempy = require('tempy')
const Parser = require('json-text-sequence').parser
const nfm = require('./nfm')

winston.configure({
  transports: [new winston.transports.Console()]
})

// configuration constants
const z = config.get('z')
const minx = config.get('minx')
const miny = config.get('miny')
const maxx = config.get('maxx')
const maxy = config.get('maxy')
const exportConfigPath = config.get('exportConfigPath')
const pbfDirPath = config.get('pbfDirPath')
const mbtilesDirPath = config.get('mbtilesDirPath')
const planetPath = config.get('planetPath')
const miniPlanetPath = tempy.file({ extension: 'osm.pbf' })
const skipMiniPlanet = config.get('skipMiniPlanet')
const skipExistingPbf = config.get('skipExistingPbf')
const skipExistingMbtiles = config.get('skipExistingMbtiles')

const iso = () => {
  return new Date().toISOString()
}

const extract = (z, x, y) => {
  return new Promise((resolve, reject) => {
    const startTime = iso()
    const bbox = tilebelt.tileToBBOX([x, y, z])
    const extractConfigPath = tempy.file({ extension: 'json' })
    const tmpPath = `${pbfDirPath}/part-${z}-${x}-${y}.osm.pbf`
    const dstPath = `${pbfDirPath}/${z}-${x}-${y}.osm.pbf`
    if (skipExistingPbf && fs.existsSync(dstPath)) {
      winston.info(`${iso()}: ${dstPath} is already there.`, {
        z: z,
        x: x,
        y: y,
        startTime: startTime,
        endTime: iso(),
        exitState: 'pbf exists'
      })
      resolve(null)
    } else {
      const extractConfig = {
        extracts: [{
          output: path.basename(tmpPath),
          output_format: 'pbf',
          bbox: bbox
        }],
        directory: path.dirname(tmpPath)
      }
      fs.writeFileSync(extractConfigPath, JSON.stringify(extractConfig))
      const osmium = spawn('osmium', [
        'extract', '--config', extractConfigPath,
        '--strategy=smart', '--overwrite', '--no-progress',
        skipMiniPlanet ? planetPath : miniPlanetPath
      ], { stdio: 'inherit' })
      osmium.on('close', () => {
        fs.renameSync(tmpPath, dstPath)
        fs.unlinkSync(extractConfigPath)
        resolve(null)
      })
    }
  })
}

const produce = (z, x, y) => {
  return new Promise((resolve, reject) => {
    const startTime = new Date()
    const bbox = tilebelt.tileToBBOX([x, y, z])
    const srcPath = `${pbfDirPath}/${z}-${x}-${y}.osm.pbf`
    const tmpPath = `${mbtilesDirPath}/part-${z}-${x}-${y}.mbtiles`
    const dstPath = `${mbtilesDirPath}/${z}-${x}-${y}.mbtiles`

    if (skipExistingMbtiles && fs.existsSync(dstPath)) {
      winston.info(`${iso()}: ${dstPath} already there.`, {
        z: z,
        x: x,
        y: y,
        startTime: startTime,
        endTime: iso(),
        exitState: 'mbtiles exists'
      })
      resolve(null)
      return
    }

    const tippecanoe = spawn('tippecanoe', [
      '--no-feature-limit', '--no-tile-size-limit',
      '--force', '--simplification=2',
      '--minimum-zoom=6', '--maximum-zoom=15', '--base-zoom=15',
      `--clip-bounding-box=${bbox.join(',')}`, '--hilbert',
      `--output=${tmpPath}` ],
    { stdio: ['pipe', 'ignore', 'ignore'] })

    let pausing = false
    const jsonTextSequenceParser = new Parser()
      .on('data', (json) => {
        let f
        try {
          f = modify(json)
        } catch (e) {
          winston.error(`${iso()}: ${e.stack}`)
          f = null
        }
        if (f) {
          if (tippecanoe.stdin.write(JSON.stringify(f))) {
          } else {
            osmium.stdout.pause()
            if (!pausing) {
              tippecanoe.stdin.once('drain', () => {
                osmium.stdout.resume()
                pausing = false
              })
              pausing = true
            }
          }
        }
      })
      .on('finish', () => {
        tippecanoe.stdin.end()
      })

    const osmium = spawn('osmium', [
      'export', '--index-type=sparse_file_array',
      `--config=${exportConfigPath}`, '--output-format=geojsonseq',
      '--output=-', srcPath ],
    { stdio: ['inherit', 'pipe', 'inherit'] })
    osmium.stdout.pipe(jsonTextSequenceParser)

    tippecanoe.on('close', () => {
      fs.renameSync(tmpPath, dstPath)
      const endTime = new Date()
      const time = TimeFormat.fromMs(endTime - startTime)
      winston.info(`${iso()}: ${z}-${x}-${y} took ${time}`, {
        z: z,
        x: x,
        y: y,
        startTime: startTime,
        endTime: iso(),
        exitStatus: 'mbtiles created',
        productionSeconds: (endTime - startTime) / 1000,
        mbtilesSize: fs.statSync(dstPath).size
      })
      resolve(null)
    })
  })
}

const queue = new Queue(async (t, cb) => {
  const startTime = new Date()
  const [z, x, y] = t
  if (nfm(z, x, y)) {
    winston.info(`${iso()}: ${z}-${x}-${y} is a no-feature-module.`, {
      z: z,
      x: x,
      y: y,
      startTime: startTime,
      endTime: endTime,
      exitState: 'no features'
    })
  } else {
    try {
      if (!skipMiniPlanet) await extract(z, x, y)
      await produce(z, x, y)
    } catch (err) {
      winston.error(`${iso()}: ${error.stack} (${z}-${x}-${y})`)
    }
  }
  return cb(null)
}, { concurrent: config.get('concurrent') })

queue.on('task_failed', (taskId, err, stats) => {
  winston.error(err.stack)
})

let queueEmpty = false

queue.on('empty', () => {
  queueEmpty = true
})

queue.on('task_finish', (taskId, result, stats) => {
  if (queueEmpty) {
    if (!skipMiniPlanet) deleteMiniPlanet()
  }
})

const createMiniPlanet = () => {
  return new Promise((resolve, reject) => {
    const lowerCorner = tilebelt.tileToBBOX([minx, maxy, z])
    const upperCorner = tilebelt.tileToBBOX([maxx, miny, z])
    const bbox = [
      lowerCorner[0], lowerCorner[1],
      upperCorner[2], upperCorner[3]
    ]
    spawn('osmium', [
      'extract', `--bbox=${bbox.join(',')}`,
      '--strategy=smart', '--overwrite', '--progress', '--verbose',
      '--output-format=pbf,pbf_compression=false,add_metadata=false',
      `--output=${miniPlanetPath}`, planetPath
    ], { stdio: 'inherit' }).on('exit', code => {
      if (code === 0) {
        resolve(null)
      } else {
        deleteMiniPlanet()
        reject(new Error(`createMiniPlanet failed.`))
      }
    })
  })
}

const deleteMiniPlanet = () => {
  fs.unlink(miniPlanetPath, (err) => {
    if (err) throw err
    winston.info(`${iso()}: deleted ${miniPlanetPath}`)
  })
}

const main = async () => {
  if (!skipMiniPlanet) { await createMiniPlanet() }
  for (let x = minx; x <= maxx; x++) {
    for (let y = miny; y <= maxy; y++) {
      queue.push([z, x, y])
    }
  }
}

main()

const config = require('config')
const Queue = require('better-queue')
const { spawnSync, spawn } = require('child_process')
const tilebelt = require('@mapbox/tilebelt')
const fs = require('fs')
const TimeFormat = require('hh-mm-ss')
const pretty = require('prettysize')
const modify = require(config.get('modifyPath'))
const winston = require('winston')
const tempy = require('tempy')
const Parser = require('json-text-sequence').parser

winston.configure({
  transports: [new winston.transports.Console()]
})

// configuration constants
const z = config.get('z')
const minx = config.get('minx')
const miny = config.get('miny')
const maxx = config.get('maxx')
const maxy = config.get('maxy')
const planetPath = config.get('planetPath')
const exportConfigPath = config.get('exportConfigPath')
const pbfDirPath = config.get('pbfDirPath')
const mbtilesDirPath = config.get('mbtilesDirPath')

const iso = () => {
  return new Date().toISOString()
}

const extract = (z, x, y) => {
  return new Promise((resolve, reject) => {
    const bbox = tilebelt.tileToBBOX([x, y, z])
    const extractConfigPath = tempy.file({ extension: 'json' })
    const dstPath = `${pbfDirPath}/${z}-${x}-${y}.osm.pbf`
    if (fs.existsSync(dstPath)) {
      winston.info(`${iso()}: ${dstPath} is already there.`)
      resolve(null)
    }

    const extractConfig = {
      extracts: [{
        output: `${z}-${x}-${y}.osm.pbf`,
        output_format: 'pbf',
        bbox: bbox
      }],
      directory: pbfDirPath
    }
    fs.writeFileSync(extractConfigPath, JSON.stringify(extractConfig))
    winston.info(`${iso()}: ${z}-${x}-${y} osmium extract started`)

    const osmium = spawn('osmium', [
      'extract', '--config', extractConfigPath,
      '--strategy=smart', '--overwrite',
      planetPath], { stdio: 'inherit' })
    osmium.on('close', () => { 
      fs.unlinkSync(extractConfigPath)
      winston.info(`${iso()}: ${z}-${x}-${y} osmium extract finished`)
      resolve(null)
    })
  })
}

const produce = (z, x, y) => {
  return new Promise((resolve, reject) => {
    const bbox = tilebelt.tileToBBOX([x, y, z])
    const srcPath = `${pbfDirPath}/${z}-${x}-${y}.osm.pbf`
    const tmpPath = `${mbtilesDirPath}/part-${z}-${x}-${y}.mbtiles`
    const dstPath = `${mbtilesDirPath}/${z}-${x}-${y}.mbtiles`

    if (fs.existsSync(dstPath)) {
      winston.info(`${iso()}: ${dstPath} aready there.`)
      resolve(null)
    }

    const tippecanoe = spawn('tippecanoe', [
      '--no-feature-limit', '--no-tile-size-limit',
      '--force', '--simplification=2',
      '--minimum-zoom=6', '--maximum-zoom=15', '--base-zoom=15',
      `--clip-bounding-box=${bbox.join(',')}`,
      `--output=${tmpPath}` ],
      { stdio: ['pipe', 'inherit', 'inherit'] })

    let pausing = false
    const jsonTextSequenceParser = new Parser()
    .on('data', (json) => {
      f = modify(json)
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
      fs.rename(tmpPath, dstPath, err => {
        if (err) reject(err)
        resolve(null)
      })
    })
  })
}

const queue = new Queue(async (t, cb) => {
  const startTime = new Date()
  const [z, x, y] = t
  await extract(z, x, y)
  await produce(z, x, y)
  return cb(null)
}, { concurrent: config.get('concurrent') })

queue.on('task_failed', (taskId, err, stats) => {
  winston.error(err.stack)
})

for (let x = minx; x <= maxx; x++) {
  for (let y = miny; y <= maxy; y++) {
    queue.push([z, x, y])
  }
}

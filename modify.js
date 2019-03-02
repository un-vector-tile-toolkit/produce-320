const geojsonArea = require('@mapbox/geojson-area')

module.exports = f => {

  f.tippecanoe = {
    minzoom: 15,
    maxzoom: 15,
    layer: 'other'
  }
// they are processed in osmium-export-config.json now.
// delete f.properties['@id']
// delete f.properties['@type']
// delete f.properties['wikidata']

  // name
  if (
    f.properties.hasOwnProperty('name:en') ||
    f.properties.hasOwnProperty('name:fr') ||
    f.properties.hasOwnProperty('name:es') ||
    f.properties.hasOwnProperty('name:pt') ||
    f.properties.hasOwnProperty('name:ar') ||
    f.properties.hasOwnProperty('int_name') ||
    f.properties.hasOwnProperty('name')
  ) {
    let name = ''
    if (f.properties['name:en']) {
      name = f.properties['name:en']
    } else if (f.properties['name:fr']) {
      name = f.properties['name:fr']
    } else if (f.properties['name:es']) {
      name = f.properties['name:es']
    } else if (f.properties['name:pt']) {
      name = f.properties['name:pt']
    } else if (f.properties['name:ar']) {
      name = f.properties['name:ar']
    } else if (f.properties['int_name']) {
      name = f.properties['int_name']
    } else {
      name = f.properties['name']
    }
    delete f.properties['int_name']
    delete f.properties['name']
    for (const key in f.properties) {
      if (key.match(/name:/)) {
        delete f.properties[key]
      }
    }
    f.properties.name = name
  }

  return place(f) ||
    water(f) ||
    building(f) ||
    road(f) ||
    railway(f) ||
    nature(f) ||
    boundary(f) ||
    route(f) ||
    structure(f)
}

const flap = (f, z) => {
  if (['MultiPolygon', 'Polygon'].includes(f.geometry.type)) {
    let mz = Math.floor(
      19 - Math.log2(geojsonArea.geometry(f.geometry)) / 2
    )
    if (mz > 15) { mz = 15 }
    if (mz < 6) { mz = 6 }
    return mz
  }
  return z ? z : 10
}

// 1. nature
const nature = (f) => {
  if (
    [
      'cemetry', 'landfill', 'meadow', 'allotments', 'recreation_ground',
      'orchard', 'vineyard', 'quarry', 'forest', 'farm', 'farmyard',
      'farmland', 'grass', 'residential', 'retail', 'commercial',
      'military', 'industrial', 'basin'
    ].includes(f.properties.landuse) ||
    [
      'tree', 'wood', 'scrub', 'heath'
    ].includes(f.properties.natural)
  ) {
    f.tippecanoe = {
      minzoom: flap(f, 15),
      maxzoom: 15,
      layer: 'nature'
    }
    return f
  }
  return null
}

// 2. water
const water = (f) => {
  if ([
    'water', 'wetland', 'coastline', 'glacier'
  ].includes(f.properties.natural)) {
    const lut = {
      water: 6,
      wetland: 8,
      coastline: 6,
      glacier: 6
    }
    f.tippecanoe = {
      minzoom: flap(f, lut[f.properties.natural]),
      maxzoom: 15,
      layer: 'water'
    }
    switch (f.geometry.type) {
      case 'LineString':
      case 'MultiLineString':
        if (['water', 'wetland'].includes(f.properties.natural)) {
          return null
        }
        break
      case 'Point':
        if (['water', 'wetland'].includes(f.properties.natural)) {
          f.tippecanoe.minzoom = 15
        }
        break
    }
    return f
  }

  if ([
    'river', 'stream', 'canal', 'drain', 'riverbank', 'ditch'
  ].includes(f.properties.waterway) &&
  !(f.properties.boundary === 'administrative')) {
    const lut = {
      river: 10,
      stream: 14,
      canal: 13,
      drain: 14,
      riverbank: 6,
      ditch: 15
    } 
    f.tippecanoe = {
      minzoom: flap(f, lut[f.properties.waterway]),
      maxzoom: 15,
      layer: 'water'
    }
    return f
  }

  if (['reservoir'].includes(f.properties.landuse)) {
    f.tippecanoe = {
      minzoom: flap(f, 6),
      maxzoom: 15,
      layer: 'water'
    }
    if (f.geometry.type === 'Point') {
      f.tippecanoe.minzoom = 15
    }
    return f
  }
  return null
}

// 3. boundary
const boundary = (f) => {
  const minzoomBoundary = () => {
    if (f.properties.boundary === 'national_park') {
      return 9
    }
    switch (f.properties.admin_level) {
      case '2':
        return 6
      case '3':
      case '4':
        return 10
      case '5':
      case '6':
      case '7':
      case '8':
        return 11
      default:
        return 13
    }
  }
  if (['administrative', 'national_park'].includes(f.properties.boundary)) {
    if (f.properties.boundary === 'national_park') return null
    f.tippecanoe = {
      minzoom: minzoomBoundary(),
      maxzoom: 15,
      layer: 'boundary'
    }
    if (
      f.properties.boundary === 'administrative' &&
      (
        ['MultiPolygon', 'Polygon'].includes(f.geometry.type) ||
        f.properties.maritime === 'yes'
      )
    ) return null
    return f
  }
  return null
}

// 4. road
const road = (f) => {
  const minzoomRoad = () => {
    switch (f.properties.highway) {
      case 'path':
      case 'pedestrian':
      case 'footway':
      case 'cycleway':
      case 'living_street':
      case 'steps':
      case 'bridleway':
      case 'service':
        return 15
      case 'residential':
      case 'track':
      case 'unclassified':
        return 14
      case 'road':
      case 'tertiary_link':
        return 13
      case 'tertiary':
      case 'secondary_link':
        return 12
      case 'secondary':
      case 'primary_link':
        return 11
      case 'primary':
      case 'trunk_link':
        return 10
      case 'trunk':
      case 'motorway_link':
        return 9
      case 'motorway':
        return 6
      default:
        return 15
    }
  }
  if ([
    'bus_stop',
    'motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link',
    'primary_link', 'secondary_link', 'tertiary', 'road', 'tertiary_link',
    'track', 'bridleway', 'cycleway', 'steps', 'living_street', 'unclassified',
    'service', 'residential', 'pedestrian', 'footway', 'path'
  ].includes(f.properties.highway)) {
    f.tippecanoe = {
      minzoom: minzoomRoad(),
      maxzoom: 15,
      layer: 'road'
    }
    return f
  }
  return null
}

// 5. railway
const railway = (f) => {
  if ([
    'station', 'halt', 'tram_stop', 'rail', 'light_rail', 'narrow_gauge', 
    'subway', 'tram', 'monorail'
  ].includes(f.properties.railway)) {
    f.tippecanoe = {
      minzoom: flap(f, 10),
      maxzoom: 15,
      layer: 'railway'
    }
    if (f.geometry.type === 'Point') {
      f.tippecanoe.minzoom = 14
    }
    if (f.properties.service) {
      f.tippecanoe.minzoom = 15
    }
    return f
  }
  return null
}

// 6. route
const route = (f) => {
  if ([
    'ferry'
  ].includes(f.properties.route)) {
    f.tippecanoe = {
      minzoom: 11,
      maxzoom: 15,
      layer: 'route'
    }
    return f
  }
  return null
}

// 7. structure
const structure = (f) => {
  if (
    [
      'aerodrome', 'airfield', 'helipad', 'aeroway', 'runway', 'taxiway'
    ].includes(f.properties.aeroway) ||
    [
      'tower', 'water_tower', 'communications_tower', 'windmill',
      'lighthouse', 'wastewater_plant', 'watermill', 'water_works',
      'water_well', 'storage_tank'
    ].includes(f.properties.man_made) ||
    [
      'station', 'tower'
    ].includes(f.properties.power) ||
    [
      'stop_position'
    ].includes(f.properties.public_transport) ||
    f.properties.barrier
  ) {
    f.tippecanoe = {
      minzoom: flap(f, 14),
      maxzoom: 15,
      layer: 'structure'
    }
    if (f.properties.barrier) f.tippecanoe.minzoom = 15
    return f
  }
  return null
}

// 8. building
const building = (f) => {
  if (f.properties.building) {
    f.tippecanoe = {
      minzoom: flap(f, 15),
      maxzoom: 15,
      layer: 'building'
    }
    return f
  }
  return null
}

// 9. place
const place = (f) => {
  if (f.geometry.type !== 'Point') return null
  if ([
    'city', 'town', 'village', 'hamlet', 'isolated_dwelling', 'locality',
    'suburb', 'neighborhood'
  ].includes(f.properties.place)) {
    f.tippecanoe = {
      minzoom: 14,
      maxzoom: 15,
      layer: 'place'
    }
    switch (f.properties.place) {
      case 'city':
        f.tippecanoe.minzoom = 8
        break
      case 'town':
        f.tippecanoe.minzoom = 10
        break
      case 'villege':
        f.tippecanoe.minzoom = 12
        break
    }
    if (f.properties.capital === 'yes') {
      f.tippecanoe.minzoom = 6
      if (f.properties.name === 'Vatican City') {
        f.tippecanoe.minzoom = 11
      }
    }
    return f
  }
  if ([
    'golf_course', 'water_park', 'pitch', 'studium', 'sports_centre',
    'swimming_pool', 'park', 'playground', 'common', 'recreation_ground',
    'nature_reserve'
  ].includes(f.properties.leisure)) {
    f.tippecanoe = {
      minzoom: flap(f, 14),
      maxzoom: 15,
      layer: 'place'
    }
    return f
  }
  if ([
    'swimming', 'tennis'
  ].includes(f.properties.sports)) {
    f.tippecanoe = {
      minzoom: flap(f, 14),
      maxzoom: 15,
      layer: 'place'
    }
    return f
  }
  if ([
    'public_building', 'townhall', 'embassy', 'courthouse', 'police',
    'prison', 'fire_station', 'post_office', 'social_facility',
    'customs', 'shelter', 'school', 'college', 'university',
    'hospital', 'fuel', 'airport', 'ferry_terminal', 'parking'
  ].includes(f.properties.amenity)) {
    f.tippecanoe = {
      minzoom: flap(f, 14),
      maxzoom: 15,
      layer: 'place'
    }
    return f
  }
  if ([
    'restaurant', 'fast_food', 'cafe', 'food_court',
    'biergarten', 'nightclub', 'pub', 'bar', 'community_centre',
    'cinema', 'library', 'arts_centre', 'money_transfer',
    'bureau_de_change', 'theatre', 'grave_yard', 'swimming_pool',
    'bank', 'atm', 'marketplace', 'car_rental', 'pharmacy',
    'waste_disposal', 'drinking_water', 'bus_station', 'parking'
  ].includes(f.properties.amenity)) {
    f.tippecanoe = {
      minzoom: flap(f, 15),
      maxzoom: 15,
      layer: 'place'
    }
    return f
  }
  if ([
    'monument', 'memorial', 'castle', 'fort',
    'archaeological_site', 'ruins'
  ].includes(f.properties.historic)) {
    f.tippecanoe = {
      minzoom: flap(f, 15),
      maxzoom: 15,
      layer: 'place'
    }
    return f
  }
  if ([
    'airfield'
  ].includes(f.properties.military)) {
    f.tippecanoe = {
      minzoom: flap(f, 14),
      maxzoom: 15,
      layer: 'place'
    }
    return f
  }
  if ([
    'government', 'ngo'
  ].includes(f.properties.office)) {
    f.tippecanoe = {
      minzoom: flap(f, 14),
      maxzoom: 15,
      layer: 'place'
    }
    return f
  }
  if ([
    'bakery'
  ].includes(f.properties.craft)) {
    f.tippecanoe = {
      minzoom: 15,
      maxzoom: 15,
      layer: 'place'
    }
    return f
  }
  if ([
    'bed_and_breakfast', 'hotel', 'motel', 'guest_house', 'hostel',
    'chalet', 'museum', 'zoo', 'theme_park'
  ].includes(f.properties.tourism)) {
    f.tippecanoe = {
      minzoom: flap(f, 15),
      maxzoom: 15,
      layer: 'place'
    }
    return f
  }
  if ([
    'car_repair', 'supermarket', 'kiosk', 'department_store', 'clothes',
    'books', 'butcher', 'beverages', 'alcohol', 'optician', 'stationery',
    'mobile_phone', 'greengrocer', 'car', 'furniture', 'computer',
    'hairdresser', 'bakery', 'travel_agency'
  ].includes(f.properties.shop)) {
    f.tippecanoe = {
      minzoom: flap(f, 15),
      maxzoom: 15,
      layer: 'place'
    }
    return f
  }
  return null
}

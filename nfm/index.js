const fs = require('fs')
const _list = require('./nfm.json').nfm.map(v => v.toString())

const nfm = (z, x, y) => {
  return _list.includes([z, x, y].toString())
}

module.exports = nfm

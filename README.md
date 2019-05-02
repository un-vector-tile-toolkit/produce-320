# produce-320
A quick vector tile production from planet.osm.pbf. This tool is designed to produce global vector tiles around within 5 days.

# install
You need the latest versions of osmium-tool and Tippecanoe installed in your system. After that, you need to install the tool as below.
```console
git clone git@github.com:un-vector-tile-toolkit/produce-320
git clone git@github.com:hfu/duodecim
cd produce-320
npm install
```

# run
```console
mkdir pbf
mkdir mbtiles
vi config/default.hjson
node index.js
```

## run for a duodecim module 
```console
node index.js 3
```
The command line option means the number assigned for [duodecim](https://github.com/hfu/duodecim).

# about the name
This project is called 320 because it is originally started as a production process to produce 320 modules covering African area.


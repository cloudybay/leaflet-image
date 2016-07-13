(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.leafletImage = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/* global L */

var queue = require('d3-queue').queue;

var cacheBusterDate = +new Date();


// handle ie can't get svg.outerHTML
Object.defineProperty(SVGElement.prototype, 'outerHTML', {
    get: function () {
        var $node, $temp;
        $temp = document.createElement('div');
        $node = this.cloneNode(true);
        $temp.appendChild($node);
        return $temp.innerHTML;
    },
    enumerable: false,
    configurable: true
});


// leaflet-image
module.exports = function leafletImage(map, callback) {
    var hasMapbox = !!L.mapbox;

    var dimensions = map.getSize(),
        layerQueue = new queue(1);

    var canvas = document.createElement('canvas');
    canvas.width = dimensions.x;
    canvas.height = dimensions.y;
    var ctx = canvas.getContext('2d');

    // dummy canvas image when loadTile get 404 error
    // and layer don't have errorTileUrl
    var dummycanvas = document.createElement('canvas');
    dummycanvas.width = 1;
    dummycanvas.height = 1;
    var dummyctx = dummycanvas.getContext('2d');
    dummyctx.fillStyle = 'rgba(0,0,0,0)';
    dummyctx.fillRect(0, 0, 1, 1);
    // layers are drawn in the same order as they are composed in the DOM:
    // tiles, paths, and then markers
    map.eachLayer(drawLayer);
    layerQueue.awaitAll(layersDone);

    function drawLayer(l) {
        if (l instanceof L.TileLayer) {
            layerQueue.defer(handleTileLayer, l);
        }
        else if (l instanceof L.Marker && l.options.icon instanceof L.Icon) {
            layerQueue.defer(handleMarkerLayer, l);
        }
        else if (l instanceof L.ImageOverlay) {
            layerQueue.defer(handleImageOverlay, l);
        }
        else if (l instanceof L.Path) {
            layerQueue.defer(handlePathRoot, l);
        }

        else {
            if (l._container) {
                if (l._container.firstChild && l._container.firstChild instanceof HTMLCanvasElement) {
                    layerQueue.defer(handleOtherCanvas, l._container);
                }
            }
        }
    }

    function done() {
        callback(null, canvas);
    }

    function layersDone(err, layers) {
        if (err) throw err;
        layers.forEach(function (layer) {
            if (layer && layer.canvas) {
                if (!layer['z-index']) {
                    ctx.drawImage(layer.canvas, 0, 0);
                }
            }
        });
        layers.forEach(function (layer) {
            if (layer && layer.canvas) {
                if (layer['z-index']) {
                    ctx.drawImage(layer.canvas, 0, 0);
                }
            }
        });
        done();
    }

    function handleTileLayer(layer, callback) {
        // `L.TileLayer.Canvas` was removed in leaflet 1.0
        var isCanvasLayer = (L.TileLayer.Canvas && layer instanceof L.TileLayer.Canvas),
            canvas = document.createElement('canvas');

        canvas.width = dimensions.x;
        canvas.height = dimensions.y;

        var ctx = canvas.getContext('2d'),
            bounds = map.getPixelBounds(),
            origin = map.getPixelOrigin(),
            zoom = map.getZoom(),
            tileSize = layer.options.tileSize;

        if (zoom > layer.options.maxZoom ||
            zoom < layer.options.minZoom ||
            // mapbox.tileLayer
            (hasMapbox &&
                layer instanceof L.mapbox.tileLayer && !layer.options.tiles)) {
            return callback();
        }

        var tileBounds = L.bounds(
            bounds.min.divideBy(tileSize)._floor(),
            bounds.max.divideBy(tileSize)._floor()),
            tiles = [],
            j, i,
            tileQueue = new queue(1);

        for (j = tileBounds.min.y; j <= tileBounds.max.y; j++) {
            for (i = tileBounds.min.x; i <= tileBounds.max.x; i++) {
                tiles.push(new L.Point(i, j));
            }
        }

        tiles.forEach(function (tilePoint) {
            var originalTilePoint = tilePoint.clone();

            if (layer._adjustTilePoint) {
                layer._adjustTilePoint(tilePoint);
            }

            var tilePos = layer._getTilePos(originalTilePoint)
                .subtract(bounds.min)
                .add(origin);

            if (tilePoint.y >= 0) {
                if (isCanvasLayer) {
                    var tile = layer._tiles[tilePoint.x + ':' + tilePoint.y];
                    tileQueue.defer(canvasTile, tile, tilePos, tileSize);
                } else {
                    var url = addCacheString(layer.getTileUrl(tilePoint));
                    tileQueue.defer(loadTile, url, tilePos, tileSize);
                }
            }

        });

        tileQueue.awaitAll(tileQueueFinish);

        function canvasTile(tile, tilePos, tileSize, callback) {
            callback(null, {
                img: tile,
                pos: tilePos,
                size: tileSize
            });
        }

        function loadTile(url, tilePos, tileSize, callback) {
            var img = new Image();
            img.crossOrigin = '';
            img.onload = function () {
                callback(null, {
                    img: this,
                    pos: tilePos,
                    size: tileSize
                });
            };
            img.onerror = function (e) {
                // use canvas instead of errorTileUrl if errorTileUrl get 404
                if (layer.options.errorTileUrl != '' && e.target.errorCheck === undefined) {
                    e.target.errorCheck = true;
                    e.target.src = layer.options.errorTileUrl;
                } else {
                    callback(null, {
                        img: dummycanvas,
                        pos: tilePos,
                        size: tileSize
                    });
                }
            };
            img.src = url;
        }

        function tileQueueFinish(err, data) {
            data.forEach(drawTile);
            callback(null, { canvas: canvas });
        }

        function drawTile(d) {
            ctx.drawImage(d.img, Math.floor(d.pos.x), Math.floor(d.pos.y),
                d.size, d.size);
        }
    }

    function handleImageOverlay(imgOverlay, callback) {
        var imgBounds = imgOverlay._bounds,
            pixelBounds = map.getPixelBounds(),
            bounds = new L.Bounds(
                map.latLngToLayerPoint(imgBounds.getNorthWest()),
                map.latLngToLayerPoint(imgBounds.getSouthEast())),
            size = bounds.getSize(),
            canvas = document.createElement('canvas');
        canvas.width = dimensions.x;
        canvas.height = dimensions.y;

        var pos = map.project(imgBounds.getNorthWest()).subtract(pixelBounds.min);
        var ctx = canvas.getContext('2d');
        var img = new Image();
        try {
            img.crossOrigin = '';
            img.src = imgOverlay._url;
            img.onload = function () {
                ctx.drawImage(this, pos.x, pos.y, size.x, size.y);
                callback(null, {
                    canvas: canvas
                });
            };
        } catch(e) {
            console.error('Element could not be drawn on canvas', imgOverlay); // eslint-disable-line no-console
        }
    }

    function handlePathRoot(root, callback) {
        root = map._pathRoot;
        var bounds = map.getPixelBounds(),
            origin = map.getPixelOrigin(),
            canvas = document.createElement('canvas');
        canvas.width = dimensions.x;
        canvas.height = dimensions.y;

        var ctx = canvas.getContext('2d');
        var pos = L.DomUtil.getPosition(root).subtract(bounds.min).add(origin);

        var img = new Image();

        // we clone root element because root attr will reset.
        root = root.cloneNode(true);
        root.setAttribute("version", "1.1");
        root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        root.setAttribute("style", "");

        var root_html = root.outerHTML;
        var url = 'data:image/svg+xml;base64,' + window.btoa(root_html);

        root.remove();
        try {
            img.src = url;
            img.crossOrigin = '';
            img.onload = function () {
                ctx.globalAlpha = 0.3;
                ctx.drawImage(img, pos.x, pos.y, canvas.width - (pos.x * 2), canvas.height - (pos.y * 2));
                callback(null, {
                    canvas: canvas
                });
            };
        } catch(e) {
            console.error('Element could not be drawn on canvas', root); // eslint-disable-line no-console
        }
    }

    function handleOtherCanvas(container, callback) {
        var source_canvas = container.firstChild,
            bounds = map.getPixelBounds(),
            origin = map.getPixelOrigin(),
            canvas = document.createElement('canvas');
        canvas.width = dimensions.x;
        canvas.height = dimensions.y;

        var ctx = canvas.getContext('2d');
        var pos = L.DomUtil.getPosition(container).subtract(bounds.min).add(origin);
        try {
            ctx.drawImage(source_canvas, pos.x, pos.y, source_canvas.width, source_canvas.height);
            callback(null, {
                canvas: canvas,
                'z-index': 999
            });
        } catch(e) {
            console.error('Element could not be drawn on canvas', canvas); // eslint-disable-line no-console
        }
    }

    function handleMarkerLayer(marker, callback) {
        var canvas = document.createElement('canvas'),
            ctx = canvas.getContext('2d'),
            pixelBounds = map.getPixelBounds(),
            pixelPoint = map.project(marker.getLatLng()),
            pos = pixelPoint.subtract(pixelBounds.min);

        canvas.width = dimensions.x;
        canvas.height = dimensions.y;

        var icon = marker._icon,
            icon_settings = marker.options.icon,
            options = icon_settings.options,
            icon_size = options.iconSize,
            url = "";

        // shift the icon position to currect position.
        if (icon_size instanceof L.Point) icon_size = [icon_size.x, icon_size.y];
        pos = shift_pos(pos, icon_size[0], icon_size[1]);

        // L.divicon
        if (options.hasOwnProperty("html")) {
            var element = icon.firstChild;

            if (element instanceof HTMLCanvasElement) {
                drawImg(ctx, element, pos, icon_size);
            }
            else if (element instanceof SVGElement){
                url = 'data:image/svg+xml;base64,' + window.btoa(options.html);
            }
        }
        // L.icon
        else {
            var icon_url = options.iconUrl;
            var isBase64 = /^data\:/.test(icon_url);
            url = isBase64 ? icon_url : addCacheString(icon_url);
        }

        try {
            var img = new Image();

            img.crossOrigin = '';
            img.src = url;

            img.onload = function () {
                drawImg(ctx, this, pos, icon_size)
            };
        } catch(e) {
            console.error('Element could not be drawn on canvas', icon); // eslint-disable-line no-console
        }

        function drawImg(ctx, target, pos, size) {
            ctx.drawImage(target, pos.x, pos.y, size[0], size[1]);
            callback(null, {
                canvas: canvas,
                'z-index': 99
            });
        }

        function shift_pos(pos, x, y) {
            pos.x = Math.round(pos.x - x + x / 2);
            pos.y = Math.round(pos.y - y / 2);

            return pos;
        }
    }
    function addCacheString(url) {
        // If it's a data URL we don't want to touch this.
        if (isDataURL(url) || url.indexOf('mapbox.com/styles/v1') !== -1) {
            return url;
        }
        return url + ((url.match(/\?/)) ? '&' : '?') + 'cache=' + cacheBusterDate;
    }

    function isDataURL(url) {
        var dataURLRegex = /^\s*data:([a-z]+\/[a-z]+(;[a-z\-]+\=[a-z\-]+)?)?(;base64)?,[a-z0-9\!\$\&\'\,\(\)\*\+\,\;\=\-\.\_\~\:\@\/\?\%\s]*\s*$/i;
        return !!url.match(dataURLRegex);
    }
};

},{"d3-queue":2}],2:[function(require,module,exports){
(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (factory((global.d3_queue = global.d3_queue || {})));
}(this, function (exports) { 'use strict';

  var version = "2.0.3";

  var slice = [].slice;

  var noabort = {};

  function Queue(size) {
    if (!(size >= 1)) throw new Error;
    this._size = size;
    this._call =
    this._error = null;
    this._tasks = [];
    this._data = [];
    this._waiting =
    this._active =
    this._ended =
    this._start = 0; // inside a synchronous task callback?
  }

  Queue.prototype = queue.prototype = {
    constructor: Queue,
    defer: function(callback) {
      if (typeof callback !== "function" || this._call) throw new Error;
      if (this._error != null) return this;
      var t = slice.call(arguments, 1);
      t.push(callback);
      ++this._waiting, this._tasks.push(t);
      poke(this);
      return this;
    },
    abort: function() {
      if (this._error == null) abort(this, new Error("abort"));
      return this;
    },
    await: function(callback) {
      if (typeof callback !== "function" || this._call) throw new Error;
      this._call = function(error, results) { callback.apply(null, [error].concat(results)); };
      maybeNotify(this);
      return this;
    },
    awaitAll: function(callback) {
      if (typeof callback !== "function" || this._call) throw new Error;
      this._call = callback;
      maybeNotify(this);
      return this;
    }
  };

  function poke(q) {
    if (!q._start) try { start(q); } // let the current task complete
    catch (e) { if (q._tasks[q._ended + q._active - 1]) abort(q, e); } // task errored synchronously
  }

  function start(q) {
    while (q._start = q._waiting && q._active < q._size) {
      var i = q._ended + q._active,
          t = q._tasks[i],
          j = t.length - 1,
          c = t[j];
      t[j] = end(q, i);
      --q._waiting, ++q._active;
      t = c.apply(null, t);
      if (!q._tasks[i]) continue; // task finished synchronously
      q._tasks[i] = t || noabort;
    }
  }

  function end(q, i) {
    return function(e, r) {
      if (!q._tasks[i]) return; // ignore multiple callbacks
      --q._active, ++q._ended;
      q._tasks[i] = null;
      if (q._error != null) return; // ignore secondary errors
      if (e != null) {
        abort(q, e);
      } else {
        q._data[i] = r;
        if (q._waiting) poke(q);
        else maybeNotify(q);
      }
    };
  }

  function abort(q, e) {
    var i = q._tasks.length, t;
    q._error = e; // ignore active callbacks
    q._data = undefined; // allow gc
    q._waiting = NaN; // prevent starting

    while (--i >= 0) {
      if (t = q._tasks[i]) {
        q._tasks[i] = null;
        if (t.abort) try { t.abort(); }
        catch (e) { /* ignore */ }
      }
    }

    q._active = NaN; // allow notification
    maybeNotify(q);
  }

  function maybeNotify(q) {
    if (!q._active && q._call) q._call(q._error, q._data);
  }

  function queue(concurrency) {
    return new Queue(arguments.length ? +concurrency : Infinity);
  }

  exports.version = version;
  exports.queue = queue;

}));
},{}]},{},[1])(1)
});

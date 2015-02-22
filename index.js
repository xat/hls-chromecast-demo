#!/usr/bin/env node

var ccPlayer = require('chromecast-player')();
var ffmpeg = require('fluent-ffmpeg');
var tempDir = require('os').tmpdir();
var fs = require('fs');
var canPlay = require('chromecast-can-play');
var express = require('express');
var mkdirp = require('mkdirp');
var ip = require('internal-ip')();
var mime = require('mime');
var util = require('util');
var rangeParser = require('range-parser');
var pathJoin = require('path').join;
var app = express();
var input = process.argv[2];
var seekOffset = 30;
var port = 7373;

var buildUrl = function(path) {
  return 'http://' + ip + ':' + port + path;
};

var getRandomInt = function(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
};

app.use(function(req, res, next) {
  // Chromecast requires this for HLS to work.
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

ccPlayer.use(function(ctx, next) {
  if (ctx.mode !== 'launch') return next();
  var path = ctx.options.path;

  canPlay(path, function(err, meta) {

    if (meta.canPlay) {
      // The File can be sent to chromecast without
      // the need of transcoding.
      console.log('input can be played without transcoding\n');
      ctx.options.path = buildUrl('/video');
      app.get('/video', function(req, res) {
        fs.createReadStream(path).pipe(res);
      });
      ctx.options.type = 'video/mp4';
      return next();
    }

    // We will store the .ts and .m3u8 files in
    // the temp dir.
    var tempP = pathJoin(tempDir, 'castnow_' + getRandomInt(100, 1000) + '');

    mkdirp(tempP, function() {
      var done = false;
      var ff = ffmpeg(path);
      var out = pathJoin(tempP, 'test.m3u8');

      if (!meta.audioSupported && !meta.videoSupported) {
        // transcode video and audio
        console.log('transcoding video and audio');
        ff = ff.videoCodec('libx264').audioCodec('libfaac');
      } else if (meta.audioSupported === false) {
        // transcode only audio
        console.log('transcoding audio only');
        ff = ff.videoCodec('copy').audioCodec('aac').audioBitrate('193k').audioFrequency(48000).audioChannels(2);
      } else if (meta.videoSupported === false) {
        // transcode only video
        console.log('transcoding video only');
        ff = ff.videoCodec('libx264').audioCodec('copy');
      }

      ff.outputOptions([
        '-hls_time 3', // each .ts file has a length of 3 seconds
        '-hls_list_size 0', // store all pieces in the .m3u8 file
        '-bsf:v h264_mp4toannexb' // ffmpeg aborts trasncoding in some cases without this
      ])
      .on('progress', function(prog) {
        if (done) return;
        // give some buffertime
        if (prog.percent > 1) {
          done = true;
          next();
        }
      })
      .on('end', function() {
        if (!done) {
          done = true;
          return next();
        }
      })
      .output(out)
      .run();

      console.log('tempdir', tempP);

      app.use(function(req, res, next) {
        var filePath = pathJoin(tempP,req.path);

        var stat = fs.statSync(filePath);
        var total = stat.size;
        var range = req.headers.range;
        var type = mime.lookup(filePath);

        res.setHeader('Content-Type', type);
        res.setHeader('Access-Control-Allow-Origin', '*');

        if (!range) {
          res.setHeader('Content-Length', total);
          res.statusCode = 200;
          return fs.createReadStream(filePath).pipe(res);
        }

        var part = rangeParser(total, range)[0];
        var chunksize = (part.end - part.start) + 1;
        var file = fs.createReadStream(filePath, {start: part.start, end: part.end});

        res.setHeader('Content-Range', 'bytes ' + part.start + '-' + part.end + '/' + total);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', chunksize);
        res.statusCode = 206;

        return file.pipe(res);
        //next();
      });

      ctx.options.path = buildUrl('/test.m3u8');
      ctx.options.streamType = 'LIVE';
      ctx.options.supportControls = true;
      ctx.options.type = 'application/x-mpegurl';
    });

  });
});

if (!input) {
  return console.log('missing file');
}

console.log('launching player with input file:', input);

ccPlayer.launch(input, function(err, p, ctx) {
  if (err) return console.log(err);

  console.log('player launched.');

  if (ctx.options.supportControls) {
    console.log('use left/right arrows to seek and the space-key to toggle between pause and play');
  }

  var stdin = process.stdin;
  stdin.setRawMode( true );
  stdin.resume();
  stdin.setEncoding('utf8');

  stdin.on('data', function(key){
    var functionKeyCodeRe = /^(?:\x1b+)(O|N|\[|\[\[)(?:(\d+)(?:;(\d+))?([~^$])|(?:1;)?(\d+)?([a-zA-Z]))/;
    var parts = functionKeyCodeRe.exec(key);

    if (key === '\u0003') {
      return process.exit();
    }

    // space-key (toggle play/pause)
    if (key === '\x1b ' || key === ' ') {
      if (p.currentSession.playerState === 'PLAYING') {
        p.pause();
      } else if (p.currentSession.playerState === 'PAUSED') {
        p.play();
      }
      return;
    }

    var code = (parts[1] || '') + (parts[2] || '') +
               (parts[4] || '') + (parts[6] || '');

    // right-key
    if (code === '[C' || code === 'OC') {
      p.getStatus(function(err, status) {
        var target = status.currentTime + seekOffset;
        console.log('seeking forward', target);
        p.seek(target);
      });
    }

    // left-key
    if (code === 'OD' || code === '[D') {
      p.getStatus(function(err, status) {
        var target = Math.max(0, status.currentTime - 30);
        console.log('seeking backward', target);
        p.seek(target);
      });
    }

  });

});

app.listen(port);

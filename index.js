#!/usr/bin/env node

var ccPlayer = require('chromecast-player')();
var ffmpeg = require('fluent-ffmpeg');
var tempDir = require('os').tmpdir();
var keypress = require('keypress');
var fs = require('fs');
var canPlay = require('chromecast-can-play');
var express = require('express');
var mkdirp = require('mkdirp');
var ip = require('internal-ip')();
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
      console.log('input can be played without transcoding');
      ctx.options.path = buildUrl('/video');
      app.get('/video', function(req, res) {
        fs.createReadStream(path).pipe(res);
      });
      ctx.options.type = 'video/mp4';
      return next();
    }

    // We will store the .ts and .m3u8 files in
    // the temp dir.
    var tempP = pathJoin(tempDir, getRandomInt(100, 1000) + '');

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
        ff = ff.videoCodec('copy').audioCodec('libfaac');
      } else if (meta.videoSupported === false) {
        // transcode only video
        console.log('transcoding video only');
        ff = ff.videoCodec('libx264').audioCodec('copy');
      }

      ff.outputOptions([
        '-hls_time 20', // each .ts file has a length of 20 seconds
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

      app.use(express.static(tempP));

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
    console.log('use left/right arrows to seek and p/r to pause and resume');
  }

  keypress(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  process.stdin.on('keypress', function(ch, key) {
    if (!key || !key.name) return;

    // seek 30 seconds forward
    if (key.name === 'right') {
      p.getStatus(function(err, status) {
        var target = status.currentTime + seekOffset;
        console.log('seeking forward', target);
        p.seek(target);
      });
    }

    // seek 30 seconds backwards
    if (key.name === 'left') {
      p.getStatus(function(err, status) {
        var target = Math.max(0, status.currentTime - 30);
        console.log('seeking backward', target);
        p.seek(target);
      });
    }

    // pause with the p-key
    if (key.name === 'p') {
      p.pause();
    }

    // resume with the r-key
    if (key.name === 'r') {
      p.play();
    }

    if (key && key.ctrl && key.name == 'c') {
      process.exit();
    }
  });
});

app.listen(port);

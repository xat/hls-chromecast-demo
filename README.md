# hls-chromecast-demo

This is a small proof of concept demo to show how videos can be transcoded and
sent to Chromecast using HLS. SEEK, PLAY and PAUSE are possible while
transcoding is in progress.
The demo also tries to detect if only audio needs to be transcoded
(in that case it will just copy the video stream).

### Installation

* clone repo
* run `npm install`
* run `./index.js <localpath to video>`

## License
MIT

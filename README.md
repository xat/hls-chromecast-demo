# hlscast

This is a small proof of concept demo to show how videos can be transcoded and
sent to Chromecast using HLS. SEEK, PLAY and PAUSE are possible while
transcoding is in progress.
The demo also tries to detect if only audio needs to be transcoded
(in that case it will just copy the video stream).

### Installation

* run `npm install hlscast -g`

### Usage

```
hlscast ./myvideo.mkv
```

## License
MIT

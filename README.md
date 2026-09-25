# gif urself

A client-side webcam GIF recorder. No build step, server, or upload: the browser samples a 400×300 canvas at 15 frames per second for three seconds and encodes the GIF locally.

Run locally with `python3 -m http.server 8765`, then open <http://localhost:8765/>. Camera access requires localhost or HTTPS.

The three encoder scripts in `lib/` came from the previous `gifs.frank.dev` deployment. They are from [jsgif](https://github.com/antimatter15/jsgif); its MIT license is in `lib/LICENSE`.

The site is served by Caddy from `/opt/homelab/sites/gifs`. Pushes to `main` deploy there automatically through the shared `homelab-deploy` workflow. To deploy manually:

```sh
rsync -av --delete --exclude='.git' --exclude='README.md' ./ homelab:/opt/homelab/sites/gifs/
```

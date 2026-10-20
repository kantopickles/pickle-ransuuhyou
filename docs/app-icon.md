# Randomizer app icon

Created 2026-10-21 with the built-in `image_gen` tool. No external image API key was used.

## Design

The main subject is a doubles draw clipboard with numbered players and shuffle arrows.
Ricchan is a small supporting illustration based on the existing owned sticker
`Ricchan_LINE_Stickers_NoText/07.png` (paddle and thumbs-up).
The official LINE account portrait remains unchanged; only this application's
LINE Login channel icon, web icon, PWA icons and login-page mark are replaced.

## Files

- `public/randomizer-app-icon.png`: 1024px master and LINE Login upload.
- `public/randomizer-icon-192.png`: login-page mark and PWA icon.
- `public/randomizer-icon-512.png`: PWA icon.
- `public/randomizer-icon-maskable-512.png`: padded maskable PWA variant.
- `public/randomizer-apple-icon.png`: 180px Apple touch icon.
- `app/icon.png` and `app/apple-icon.png`: file-based metadata compatibility.
- `public/ricchan-official-account.png`: previous portrait, retained for the demo's official-account identity.

All exported app icons are opaque RGB PNGs. The maskable variant mechanically
resizes the artwork to 384px and adds a 64px teal margin on each side. Existing
legacy icon filenames also contain the new artwork for older links.

## Final Image Generation Prompt

Input 1: initial generated draw icon. Input 2: the existing `07.png` sticker.

> Edit image 1, the finished square pickleball draw app icon. Keep its clipboard, shuffle symbol, first doubles row with 1 2 VS 3 4, background, bold line style and colors unchanged. Make ONE precise correction: replace the illustrated girl in image 1 with the EXACT pre-existing transparent Ricchan sticker from image 2 as a faithful cutout insert. Do not redesign, reinterpret or restyle this sticker. Preserve the exact girl face, cheerful expression, actual pink cursive Ricchan lettering on her white hat, dark goggles, the original dark paddle with pink edge, pink shirt with its small white chest crest, white cape and thumbs-up pose from image 2. Use the full original sticker down to its existing lower torso cutoff. Make this sticker SMALLER: around 27% of canvas width and 33% of canvas height, anchored near the lower-right of the clipboard with generous background margin to the square canvas edges. Keep the lime pickleball accent near its left but secondary. This is a useful MATCH SCHEDULE icon with only a small recognizable existing mascot sticker accent, never a girl portrait icon. Keep all four top-row player numbers completely unobscured. Single square opaque app icon only, full bleed solid teal background, no extra text beyond existing numbers and original tiny Ricchan hat lettering. Preserve image 1 everywhere except this small mascot replacement and what needs to be filled behind the now-smaller mascot.

The tool's output is a generated rendition using the sticker as reference, not a
claim of pixel-identical reuse. The original sticker file is not altered.

## Cache and Installation

New icon filenames avoid the previous portrait's cached URLs. The service worker
cache advances to `pickleball-pwa-v4`; the PWA identity and saved app data are not
changed. Some already-installed home-screen shortcuts may require re-adding the
app before the operating system displays the new icon.

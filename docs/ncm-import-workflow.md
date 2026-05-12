# NCM Import Workflow

This workflow is for local `.ncm` files you already have the right to process.
It does not download music, manage NetEase accounts, or provide a public
conversion service.

The idea is:

```text
/opt/music-library/ncm-source/  ->  ncmdump-go  ->  /opt/music-library/source/
                                                        |
                                                        v
                                              generate songs.json
```

## 1. Install ncmdump-go

Download the Linux amd64 release from:

```text
https://git.taurusxin.com/taurusxin/ncmdump-go
```

Put the binary somewhere in PATH, for example:

```bash
chmod +x ncmdump-go
mv ncmdump-go /usr/local/bin/ncmdump-go
ncmdump-go -h
```

If the binary name is different, either rename it to `ncmdump-go` or pass
`--binary /path/to/binary` to the wrapper script.

## 2. Prepare Directories

```bash
mkdir -p /opt/music-library/ncm-source
mkdir -p /opt/music-library/source
mkdir -p /opt/music-library/public
```

Upload `.ncm` files to:

```text
/opt/music-library/ncm-source/
```

If you want sections on the music page, create first-level folders and upload
music into them:

```text
/opt/music-library/ncm-source/二次元/
/opt/music-library/ncm-source/摇滚/
/opt/music-library/ncm-source/流行/
```

The generator uses the first folder name as the song category.

If your NetEase download directory is already organized as artist/album/song,
run the generator with `--category-depth 2` to use album names as sections, or
`--category-depth 0` to disable folder sections.

## 3. Convert NCM Files

From the deployed theme directory:

```bash
cd /opt/1panel/apps/halo/halo/data/themes/theme-fuwari

node scripts/convert-ncm-library.mjs \
  --input /opt/music-library/ncm-source \
  --output /opt/music-library/source
```

This calls:

```bash
ncmdump-go -d /opt/music-library/ncm-source -o /opt/music-library/source -r
```

## 4. Refresh the Music Library

```bash
node scripts/generate-music-library.mjs \
  --input /opt/music-library/source \
  --output /opt/music-library/public \
  --public-base /music-library \
  --category-depth 2 \
  --skip-existing
```

The music page should read:

```text
/music-library/songs.json
```

## Daily Use

```text
Upload .ncm -> run ncm converter -> run music generator -> refresh /music
```

No Halo restart is needed when only music files or `songs.json` changed.

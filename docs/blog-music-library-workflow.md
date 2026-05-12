# Halo Fuwari 音乐馆重构：本地音乐库、NCM 转换、自动封面歌词与点歌心愿单

## 前言

上一篇记录里，我把 Fuwari 主题从直接修改 `templates/*.html` 的方式迁移到了 Astro 源码开发流程。视频放映室、侧边栏归档、图库瀑布流都被拆成了更可维护的组件。

这次继续沿着这个方向，把“音乐馆”做成一个真正可长期使用的页面：我只需要整理音乐文件，脚本会自动转换、读取元数据、生成封面歌词和 `songs.json`，前台页面负责播放、筛选、搜索和点歌。

## 一、目标

这次音乐馆要解决几个实际问题：

- 不再手动维护巨大的 JSON 歌单。
- 支持服务器上的本地歌曲在线播放。
- 支持按歌手、专辑、分区筛选。
- 支持搜索歌名、歌手、专辑。
- 自动读取 MP3/FLAC 等音频文件里的标题、歌手、专辑、音轨号、封面、歌词。
- 支持网易云 `.ncm` 文件先转换再入库。
- 音乐页不显示博客侧边栏，更像一个独立播放器页面。
- 用户可以在音乐馆底部留言点歌。

## 二、页面架构

音乐馆不是单独写一个 `/music.astro` 路由，而是沿用 Halo 单页机制：

```text
Halo 后台新建单页，别名 music
        ↓
templates/page.html
        ↓
singlePage.spec.slug == 'music'
        ↓
渲染 MusicLibrary.astro
```

这样做的好处是和视频放映室保持一致，不会被 Halo 的自定义页面路由卡住，也方便后台菜单直接指向 `/music`。

核心入口在 `src/pages/page.astro`：

```astro
<div
  th:if="${singlePage.metadata.name == 'music' or singlePage.spec.slug == 'music'}"
>
  <MusicLibrary />
</div>
```

同时我给 `MainGridLayout.astro` 加了一个 `wideExpression`，当页面是 `music` 时隐藏侧边栏：

```astro
<div
  id="main-grid"
  th:with={`layoutWide=${wideExpression}`}
  th:classappend="${layoutWide ? ' layout-wide' : ''}"
>
  <div class="contents" th:if="${not layoutWide}">
    <SideBar />
  </div>
</div>
```

于是音乐馆页面不会再挤在博客侧边栏旁边，而是使用完整主区域。

## 三、歌曲数据来源

最开始我考虑过把歌曲列表放进 `settings.yaml`，但这很快会变成维护灾难。几十首歌的标题、歌手、专辑、封面、歌词、URL 全塞进主题设置表单，后台会非常难用。

现在改为外部 JSON：

```json
[
  {
    "title": "The Root of All Evil",
    "artist": "Dream Theater",
    "album": "Octavarium",
    "category": "ROCK",
    "track": 1,
    "cover": "/music-library/covers/Dream-Theater-The-Root-of-All-Evil.jpg",
    "url": "/music-library/songs/Dream-Theater-The-Root-of-All-Evil.mp3",
    "lrc": "/music-library/lyrics/Dream-Theater-The-Root-of-All-Evil.lrc",
    "duration": "8:25"
  }
]
```

主题设置里只需要填一个地址：

```text
/music-library/songs.json
```

歌曲、封面、歌词都放在服务器的静态目录中，不再跟主题包一起上传。

## 四、服务器目录设计

我现在的目录大致是这样：

```text
/opt/music-library/
├── ncm-source/              # 原始 ncm 文件
│   └── ROCK/
│       └── Dream Theater/
│           └── Octavarium/
│               ├── 01 - The Root of All Evil.ncm
│               └── 01 - The Root of All Evil.lrc
├── source/                  # 转换后的 mp3/flac
└── public/                  # 对外访问的静态目录
    ├── songs.json
    ├── songs/
    ├── covers/
    └── lyrics/
```

Nginx 暴露静态目录：

```nginx
location /music-library/ {
    alias /opt/music-library/public/;
    add_header Access-Control-Allow-Origin * always;
}
```

访问：

```text
https://blog.fallrain0905.top/music-library/songs.json
```

## 五、NCM 转换流程

`.ncm` 转换使用 `ncmdump-go`。主题项目里只写了一个包装脚本，它不下载音乐，也不处理账号，只转换我本地或服务器上已经存在的文件。

转换命令：

```bash
cd /opt/1panel/apps/halo/halo/data/themes/theme-fuwari

node scripts/convert-ncm-library.mjs \
  --input /opt/music-library/ncm-source \
  --output /opt/music-library/source
```

脚本实际调用：

```bash
ncmdump-go -d /opt/music-library/ncm-source -o /opt/music-library/source -r
```

`-r` 会递归保留目录结构，所以：

```text
ncm-source/ROCK/Dream Theater/Octavarium/song.ncm
```

会转换为：

```text
source/ROCK/Dream Theater/Octavarium/song.mp3
```

同目录下的 `.lrc`、`.txt`、`.jpg`、`.png` 等旁挂文件也会一起复制到 `source`。

## 六、自动生成 songs.json

转换完成后运行生成脚本：

```bash
node scripts/generate-music-library.mjs \
  --input /opt/music-library/source \
  --output /opt/music-library/public \
  --public-base /music-library \
  --category-depth 1 \
  --clean
```

脚本会扫描这些格式：

```text
.mp3 .flac .m4a .ogg .wav
```

并自动读取：

- 标题
- 歌手
- 专辑
- 音轨号
- 时长
- 内嵌封面
- 内嵌歌词
- 同名 `.lrc` 歌词
- 同名封面图片

`--category-depth` 用来控制页面分区来自第几层目录。

例如当前结构：

```text
source/ROCK/Dream Theater/Octavarium/song.mp3
```

使用：

```bash
--category-depth 1
```

页面分区就是 `ROCK`。

如果想用专辑作为分区，可以改成：

```bash
--category-depth 3
```

如果不想按文件夹分区：

```bash
--category-depth 0
```

## 七、前台音乐馆功能

`MusicLibrary.astro` 负责前台播放体验：

- 顶部搜索框：搜索歌名、歌手、专辑。
- 歌手筛选。
- 专辑筛选。
- 分区筛选，例如 `ROCK`、`ACG`、`POP`。
- 当前播放封面。
- 播放、暂停、上一首、下一首。
- 顺序播放、单曲循环、随机播放。
- 音量控制。
- 歌词显示。

歌词滚动这里踩过一个坑：一开始使用 `scrollIntoView` 让当前歌词居中，但它会带动整个页面自动跳到播放器底部。现在改成只滚动歌词容器：

```js
ui.lyrics.scrollTo({
  top:
    activeLine.offsetTop -
    ui.lyrics.clientHeight / 2 +
    activeLine.clientHeight / 2,
  behavior: "smooth",
});
```

这样歌词可以跟随播放滚动，但不会强制改变页面位置。

## 八、图标显示修复

播放按钮、上一首、下一首一开始用的是 `astro-icon` 输出的 SVG。部分设备上按钮功能正常，但图标只剩一个空圆圈。

后来改成主题现有的 Iconify CSS 图标写法：

```html
<span class="icon-[material-symbols--play-arrow-rounded]"></span>
<span class="icon-[material-symbols--skip-previous-rounded]"></span>
<span class="icon-[material-symbols--skip-next-rounded]"></span>
```

这和 Fuwari 主题其他位置的图标风格一致，也更稳定。

## 九、点歌心愿单

音乐馆底部新增了一个“点歌心愿单”。它没有额外写后端，而是复用 Halo 评论组件：

```astro
<halo:comment
  group="content.halo.run"
  kind="SinglePage"
  th:attr="name=${singlePage.metadata.name}"></halo:comment>
```

用户可以在音乐馆页面留言想听的歌，我在 Halo 后台评论管理里就能看到。

如果评论功能没启用，这个区域会自动隐藏。

## 十、部署与日常使用

主题代码更新后，需要本地构建并上传主题：

```powershell
pnpm.cmd build:only

scp -P 2595 -r .\templates .\settings.yaml .\i18n .\theme.yaml .\scripts .\docs .\package.json .\pnpm-lock.yaml root@64.90.20.245:/opt/1panel/apps/halo/halo/data/themes/theme-fuwari/
```

然后重启 Halo：

```bash
docker restart 1Panel-halo-XnHB
```

日常加歌不需要重新构建主题，只需要：

```bash
cd /opt/1panel/apps/halo/halo/data/themes/theme-fuwari

node scripts/convert-ncm-library.mjs \
  --input /opt/music-library/ncm-source \
  --output /opt/music-library/source

node scripts/generate-music-library.mjs \
  --input /opt/music-library/source \
  --output /opt/music-library/public \
  --public-base /music-library \
  --category-depth 1 \
  --clean
```

然后刷新 `/music` 页面即可。

## 十一、关于缓存和旧文件

如果整理过目录结构，一定要注意旧的 `source` 目录可能还留着之前转换出来的歌曲。比如同时存在：

```text
source/Dream Theater/Octavarium/song.mp3
source/ROCK/Dream Theater/Octavarium/song.mp3
```

那么生成出来的 `songs.json` 里就会出现两个分区：`Dream Theater` 和 `ROCK`。

最干净的做法是重建一次：

```bash
mv /opt/music-library/source /opt/music-library/source.bak-$(date +%Y%m%d-%H%M%S)
mkdir -p /opt/music-library/source
```

再重新转换和生成 JSON。

如果浏览器仍然显示旧数据，可以临时给主题设置里的 JSON 地址加版本号：

```text
/music-library/songs.json?v=20260512-1
```

## 总结

这次音乐馆改造之后，维护方式从“手写 JSON + 手动传文件”变成了：

```text
整理音乐目录 -> 转换 ncm -> 读取元数据 -> 生成 songs.json -> 前台自动展示
```

主题只负责页面和播放器，音乐资源独立放在服务器静态目录里。这样既不会让主题包越来越大，也不会每次加歌都重新上传几 GB 文件。

更重要的是，整个流程已经变成可重复的脚本化工作。以后加一个专辑，只需要把文件放到正确目录，跑两条命令，就能在音乐馆里看到它。

# PvZ-Portable 存档结构（网页编辑器实现依据）

本文依据上游 [wszqkzqk/PvZ-Portable](https://github.com/wszqkzqk/PvZ-Portable) 源码整理：

- `src/Lawn/System/PlayerInfo.cpp` / `PlayerInfo.h`
- `src/Lawn/System/ProfileMgr.cpp`
- `src/Lawn/System/DataSync.cpp`
- `src/Lawn/System/SaveGame.cpp`
- `scripts/pvzp-v4-converter.py`
- 原版 PvZ 1.2.0.1073 的 `user1.dat` 文献

## 1. 存档路径

桌面版可写数据位于 `io.github.wszqkzqk/PvZPortable/userdata/`；WebAssembly 版挂载在 Emscripten 文件系统的 `/saves/userdata`。常见文件：

| 文件 | 内容 |
| --- | --- |
| `users.dat` | 玩家档案索引：名字、使用序号、ID |
| `user1.dat`, `user2.dat`, … | 玩家进度：金币、等级、挑战记录、购买记录、禅境花园、成就、Zombatar |
| `game1_0.v4`, `game1_1.v4`, … | 关卡内存档（PvZ-Portable 的结构化 TLV 格式） |
| `game1_0.dat` 等 | 旧版原始内存 dump，含平台相关布局，编辑器不支持安全编辑 |

本项目 `pvz.html` 会把整个 `/saves` 文件树打包成 ZIP 快照，存入 IndexedDB 数据库 `pvz-browser-saves`，对象仓库 `saves`，键 `userdata`。编辑器可直接读写该快照，也支持本地文件拖拽。

## 2. `users.dat`（版本 14）

所有整数小端序。

| 偏移 | 类型 | 说明 |
| --- | --- | --- |
| 0x00 | u32 | 版本 = 14 |
| 0x04 | u16 | 用户数量 |
| 0x06 … | 重复 | 每个用户：`u16 名字字节数` + 名字字节 + `u32 useSeq` + `u32 id` |

名字在 PvZ-Portable 中按 UTF-8/原字节保存；原版 Windows 存档可能是 ANSI/本地代码页。编辑器在无法用 UTF-8 解码时退化为 Latin-1，以保持字节可回写。

## 3. `userN.dat`（版本 12）

| 偏移 | 类型 | 说明 |
| --- | --- | --- |
| 0x000 | u32 | 版本 = 12 |
| 0x004 | i32 | 关卡等级 |
| 0x008 | i32 | 金币（游戏显示值 = 此值 × 10） |
| 0x00C | u32 | 是否通关冒险 |
| 0x010 | 100 × u32 | 挑战/小游戏/生存记录 |
| 0x1A0 | 80 × u32 | 商店/购买记录 |
| 0x2E0 | u32 | 主动游戏时间（秒） |
| 0x2E4 | u32 | 非主动游戏时间（秒） |
| 0x2E8 | u32 | 使用过作弊码 |
| 0x2EC | u32 | 唤醒过 Stinky |
| 0x2F0 | u32 | 未购买卡槽升级 |
| 0x2F4 | u32 | 上次巧克力时间 |
| 0x2F8/0x2FC | i32/i32 | Stinky 坐标 |
| 0x300 | u32 | 解锁小游戏 |
| 0x304 | u32 | 解锁解谜模式 |
| 0x308 | u32 | 新小游戏提示 |
| 0x30C | u32 | 新花瓶破坏者提示 |
| 0x310 | u32 | 新我是僵尸提示 |
| 0x314 | u32 | 新生存模式提示 |
| 0x318 | u32 | 解锁生存模式 |
| 0x31C | u32 | 选择界面提示 |
| 0x320 | u32 | 需要魔法玉米饼奖励 |
| 0x324 | u32 | 见过 Stinky |
| 0x328 | u32 | 见过 Upsell |
| 0x32C | u32 | 占位统计字段 |
| 0x330 | u32 | 禅境花园植物数量（≤200） |
| 0x334 … | 每株 88 字节 | 植物记录 |
| 植物之后 | 20 × u16 | 成就 |
| 之后 | u8 | Zombatar 已接受 |
| 之后 | u32 | Zombatar 数量 |
| 之后 | n × 0x48 | Zombatar 数据 |
| 之后 | 20 × u8 | 小游戏标志 |
| 最后 | u8 | Zombatar 创建于旧版本 |

88 字节植物记录：`seedType, garden, x, y, facing, padding1` 各 i32；`lastWatered` i64；`drawVariation, plantAge, timesFed, feedingsPerGrow, plantNeed, padding2` 各 i32；`lastNeedFulfilled, lastFertilized, lastChocolate, futureAttribute` 各 i64。

## 4. `gameN_M.v4`

### 文件头（24 字节）

| 偏移 | 类型 | 说明 |
| --- | --- | --- |
| 0 | 12 bytes | magic `PVZP_SAVE4\0\0` |
| 12 | u32 | 格式版本 = 1 |
| 16 | u32 | payload 长度 |
| 20 | u32 | payload 的 CRC32（zlib） |

### payload：chunk 序列

每个 chunk：

```
u32 type
u32 dataSize
bytes data:
  u32 version = 1
  u32 layout  = 1
  u32 innerSize
  bytes inner
```

chunk 名称由 `src/Lawn/System/SaveGame.cpp` 定义，常见：

`BOARD_BASE`, `PLANTS`, `ZOMBIES`, `PROJECTILES`, `COINS`, `MOWERS`, `GRIDITEMS`, `SEEDBANK`, `SEEDPACKETS`, `CHALLENGE`, `CURSOR`, `CURSOR_PREVIEW`, `MUSIC`。其余 chunk（粒子、动画等）由编辑器原样保留。

### BOARD_BASE

`inner = u32 tlvSize + TLV 字段`。TLV 字段为 `u32 id + u32 size + bytes data`，按 id 排序。字段 18 是 100 波 × 50 个 i32 的僵尸数组，`-1` 表示一波结束；字段 31 是总波数；字段 30 是当前阳光；字段 26 是关卡；字段 25 是场景。未知字段原样保留。

### 对象数组（PLANTS/ZOMBIES 等）

`inner` 直接以 5 个 u32 开头：`freeListHead, maxUsedCount, size, nextKey, maxSize`，随后是 `maxUsedCount` 个槽位：

```
u32 itemId        // 高位非零表示活动对象
u32 itemSize
bytes itemData    // TLV 字段：1 = GameObject，100 = 对象字段，其余保留
```

GameObject 为 25 字节：`x, y, width, height` i32，`visible` u8，`row` i32，`renderOrder` i32。字段 100 按对象类型（僵尸/植物/子弹/金币/割草机/格子物品）使用固定 schema，编辑器按 schema 偏移量原地修改，保持其余字节不变。

### 单对象与卡槽

`SEEDBANK`, `CHALLENGE`, `MUSIC` 等 singleton 的 `inner = u32 tlvSize + TLV 字段`；`SEEDPACKETS` 的 `inner = i32 count + count × (u32 size + itemData)`。

## 5. 编辑器文件

- `save-editor.html`：页面与样式
- `save-editor.js`：交互、表单、浏览器存档读写
- `pvz-save-core.js`：纯二进制解析/序列化核心，无 DOM 依赖，也可在 Node 中测试

编辑器支持：

- 拖拽/选择本地 `users.dat`、`userN.dat`、`game*.v4`
- 从浏览器 IndexedDB 快照（或 IDBFS）读取存档，修改后写回
- 从云存档槽位载入整个 `userdata` ZIP，编辑后重新上传到槽位（需设备登录）
- 玩家等级、金币、通关状态、解锁标志、挑战记录、商店记录、禅境花园、成就
- .v4 关卡阳光、波次、场景、僵尸/植物/子弹等对象字段
- 下载修改后的文件；CRC32 自动重算；未知字段/未知 chunk 原样保留

不支持：旧版原始内存 `.dat` dump 的安全编辑、Zombatar 图像内容编辑、增删对象引用关系的自动修复。

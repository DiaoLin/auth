/*
 * PvZ-Portable save core
 *
 * Pure binary parsing / writing for:
 *   - userdata/users.dat  (profile index, format version 14)
 *   - userdata/userN.dat  (player profile, format version 12)
 *   - userdata/gameN_M.v4 (mid-level save, PVZP_SAVE4 / TLV chunks)
 *
 * The layout is based on the upstream PvZ-Portable sources:
 *   src/Lawn/System/PlayerInfo.cpp
 *   src/Lawn/System/ProfileMgr.cpp
 *   src/Lawn/System/DataSync.cpp
 *   src/Lawn/System/SaveGame.cpp
 *   scripts/pvzp-v4-converter.py
 *
 * This file has no DOM dependencies and also works in Node.js for tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PvzSaveCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAGIC_V4 = "PVZP_SAVE4\0\0";
  const V4_HEADER_SIZE = 24;
  const V4_VERSION = 1;
  const USER_VERSION = 12;
  const PROFILE_VERSION = 14;
  const MAX_POTTED_PLANTS = 200;
  const ZOMBATAR_RECORD_SIZE = 0x48;
  const MAX_ZOMBATAR_HEADS = 100;
  const MAX_WAVES = 100;
  const MAX_ZOMBIES_IN_WAVE = 50;
  const PURCHASE_COUNT_OFFSET = 1000;
  const KEY_MASK = 0xffff0000;
  const SEEDBANK_MAX = 10;

  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder("utf-8", { fatal: false });

  /* ------------------------------------------------------------------ */
  /* Binary helpers                                                     */
  /* ------------------------------------------------------------------ */

  class Reader {
    constructor(bytes) {
      this.data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      this.view = new DataView(this.data.buffer, this.data.byteOffset, this.data.byteLength);
      this.pos = 0;
    }
    get remaining() { return this.data.length - this.pos; }
    need(n) {
      if (this.pos + n > this.data.length) {
        throw new Error(`意外的文件结尾（需要 ${n} 字节，仅剩 ${this.remaining} 字节）`);
      }
    }
    skip(n) { this.need(n); this.pos += n; }
    u8() { this.need(1); return this.data[this.pos++]; }
    u16() { this.need(2); const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
    u32() { this.need(4); const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
    i32() { this.need(4); const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
    i64() { this.need(8); const v = this.view.getBigInt64(this.pos, true); this.pos += 8; return Number(v); }
    f32() { this.need(4); const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
    bytes(n) { this.need(n); const v = this.data.slice(this.pos, this.pos + n); this.pos += n; return v; }
    rest() { return this.bytes(this.remaining); }
    string16() {
      const n = this.u16();
      const raw = this.bytes(n);
      return { text: decodeText(raw), raw };
    }
  }

  class Writer {
    constructor() { this.buf = new Uint8Array(256); this.len = 0; this.view = new DataView(this.buf.buffer); }
    ensure(n) {
      if (this.len + n <= this.buf.length) return;
      let size = this.buf.length;
      while (size < this.len + n) size *= 2;
      const next = new Uint8Array(size);
      next.set(this.buf.subarray(0, this.len));
      this.buf = next;
      this.view = new DataView(next.buffer);
    }
    u8(v) { this.ensure(1); this.view.setUint8(this.len, v & 0xff); this.len += 1; }
    u16(v) { this.ensure(2); this.view.setUint16(this.len, v & 0xffff, true); this.len += 2; }
    u32(v) { this.ensure(4); this.view.setUint32(this.len, v >>> 0, true); this.len += 4; }
    i32(v) { this.ensure(4); this.view.setInt32(this.len, v | 0, true); this.len += 4; }
    i64(v) { this.ensure(8); this.view.setBigInt64(this.len, BigInt(Math.trunc(v)), true); this.len += 8; }
    f32(v) { this.ensure(4); this.view.setFloat32(this.len, Number(v), true); this.len += 4; }
    raw(bytes) { this.ensure(bytes.length); this.buf.set(bytes, this.len); this.len += bytes.length; }
    string16(textOrBytes) {
      const raw = typeof textOrBytes === "string" ? textEncoder.encode(textOrBytes) : textOrBytes;
      if (raw.length > 0xffff) throw new Error("字符串过长（最大 65535 字节）");
      this.u16(raw.length);
      this.raw(raw);
    }
    toBytes() { return this.buf.slice(0, this.len); }
  }

  function decodeText(raw) {
    const text = textDecoder.decode(raw);
    if (!text.includes("\uFFFD")) return text;
    // Original PvZ saves often use the system ANSI code page. UTF-8 fails for
    // such names; Latin-1 at least keeps the bytes round-trippable.
    let out = "";
    for (const b of raw) out += String.fromCharCode(b);
    return out;
  }

  function readU32(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
  }
  function writeU32(bytes, offset, value) {
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value >>> 0, true);
  }
  function readI32(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset, true);
  }
  function writeI32(bytes, offset, value) {
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setInt32(offset, value | 0, true);
  }
  function readI64(bytes, offset) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigInt64(offset, true);
    return Number(v);
  }
  function writeI64(bytes, offset, value) {
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setBigInt64(offset, BigInt(Math.trunc(value)), true);
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function hex(bytes, limit = 256) {
    const n = Math.min(bytes.length, limit);
    let out = "";
    for (let i = 0; i < n; i++) out += bytes[i].toString(16).padStart(2, "0");
    return out + (bytes.length > limit ? "…" : "");
  }

  /* ------------------------------------------------------------------ */
  /* Enum tables (values match src/ConstEnums.h)                        */
  /* ------------------------------------------------------------------ */

  const SEED_TYPE = {
    "-1": "SEED_NONE", 0: "SEED_PEASHOOTER", 1: "SEED_SUNFLOWER", 2: "SEED_CHERRYBOMB",
    3: "SEED_WALLNUT", 4: "SEED_POTATOMINE", 5: "SEED_SNOWPEA", 6: "SEED_CHOMPER",
    7: "SEED_REPEATER", 8: "SEED_PUFFSHROOM", 9: "SEED_SUNSHROOM", 10: "SEED_FUMESHROOM",
    11: "SEED_GRAVEBUSTER", 12: "SEED_HYPNOSHROOM", 13: "SEED_SCAREDYSHROOM", 14: "SEED_ICESHROOM",
    15: "SEED_DOOMSHROOM", 16: "SEED_LILYPAD", 17: "SEED_SQUASH", 18: "SEED_THREEPEATER",
    19: "SEED_TANGLEKELP", 20: "SEED_JALAPENO", 21: "SEED_SPIKEWEED", 22: "SEED_TORCHWOOD",
    23: "SEED_TALLNUT", 24: "SEED_SEASHROOM", 25: "SEED_PLANTERN", 26: "SEED_CACTUS",
    27: "SEED_BLOVER", 28: "SEED_SPLITPEA", 29: "SEED_STARFRUIT", 30: "SEED_PUMPKINSHELL",
    31: "SEED_MAGNETSHROOM", 32: "SEED_CABBAGEPULT", 33: "SEED_FLOWERPOT", 34: "SEED_KERNELPULT",
    35: "SEED_INSTANT_COFFEE", 36: "SEED_GARLIC", 37: "SEED_UMBRELLA", 38: "SEED_MARIGOLD",
    39: "SEED_MELONPULT", 40: "SEED_GATLINGPEA", 41: "SEED_TWINSUNFLOWER", 42: "SEED_GLOOMSHROOM",
    43: "SEED_CATTAIL", 44: "SEED_WINTERMELON", 45: "SEED_GOLD_MAGNET", 46: "SEED_SPIKEROCK",
    47: "SEED_COBCANNON", 48: "SEED_IMITATER", 49: "SEED_EXPLODE_O_NUT", 50: "SEED_GIANT_WALLNUT",
    51: "SEED_SPROUT", 52: "SEED_LEFTPEATER",
    54: "SEED_BEGHOULED_BUTTON_SHUFFLE", 55: "SEED_BEGHOULED_BUTTON_CRATER",
    56: "SEED_SLOT_MACHINE_SUN", 57: "SEED_SLOT_MACHINE_DIAMOND",
    58: "SEED_ZOMBIQUARIUM_SNORKLE", 59: "SEED_ZOMBIQUARIUM_TROPHY",
    60: "SEED_ZOMBIE_NORMAL", 61: "SEED_ZOMBIE_TRAFFIC_CONE", 62: "SEED_ZOMBIE_POLEVAULTER",
    63: "SEED_ZOMBIE_PAIL", 64: "SEED_ZOMBIE_LADDER", 65: "SEED_ZOMBIE_DIGGER",
    66: "SEED_ZOMBIE_BUNGEE", 67: "SEED_ZOMBIE_FOOTBALL", 68: "SEED_ZOMBIE_BALLOON",
    69: "SEED_ZOMBIE_SCREEN_DOOR", 70: "SEED_ZOMBONI", 71: "SEED_ZOMBIE_POGO",
    72: "SEED_ZOMBIE_DANCER", 73: "SEED_ZOMBIE_GARGANTUAR", 74: "SEED_ZOMBIE_IMP",
  };

  const ZOMBIE_TYPE = {
    "-1": "ZOMBIE_INVALID", 0: "ZOMBIE_NORMAL", 1: "ZOMBIE_FLAG", 2: "ZOMBIE_TRAFFIC_CONE",
    3: "ZOMBIE_POLEVAULTER", 4: "ZOMBIE_PAIL", 5: "ZOMBIE_NEWSPAPER", 6: "ZOMBIE_DOOR",
    7: "ZOMBIE_FOOTBALL", 8: "ZOMBIE_DANCER", 9: "ZOMBIE_BACKUP_DANCER", 10: "ZOMBIE_DUCKY_TUBE",
    11: "ZOMBIE_SNORKEL", 12: "ZOMBIE_ZAMBONI", 13: "ZOMBIE_BOBSLED", 14: "ZOMBIE_DOLPHIN_RIDER",
    15: "ZOMBIE_JACK_IN_THE_BOX", 16: "ZOMBIE_BALLOON", 17: "ZOMBIE_DIGGER", 18: "ZOMBIE_POGO",
    19: "ZOMBIE_YETI", 20: "ZOMBIE_BUNGEE", 21: "ZOMBIE_LADDER", 22: "ZOMBIE_CATAPULT",
    23: "ZOMBIE_GARGANTUAR", 24: "ZOMBIE_IMP", 25: "ZOMBIE_BOSS", 26: "ZOMBIE_PEA_HEAD",
    27: "ZOMBIE_WALLNUT_HEAD", 28: "ZOMBIE_JALAPENO_HEAD", 29: "ZOMBIE_GATLING_HEAD",
    30: "ZOMBIE_SQUASH_HEAD", 31: "ZOMBIE_TALLNUT_HEAD", 32: "ZOMBIE_REDEYE_GARGANTUAR",
  };

  const BACKGROUND_TYPE = {
    0: "BACKGROUND_1_DAY", 1: "BACKGROUND_2_NIGHT", 2: "BACKGROUND_3_POOL",
    3: "BACKGROUND_4_FOG", 4: "BACKGROUND_5_ROOF", 5: "BACKGROUND_6_BOSS",
    6: "BACKGROUND_MUSHROOM_GARDEN", 7: "BACKGROUND_GREENHOUSE",
    8: "BACKGROUND_ZOMBIQUARIUM", 9: "BACKGROUND_TREEOFWISDOM",
  };

  const GRID_SQUARE_TYPE = { 0: "GRIDSQUARE_NONE", 1: "GRIDSQUARE_GRASS", 2: "GRIDSQUARE_DIRT", 3: "GRIDSQUARE_POOL", 4: "GRIDSQUARE_HIGH_GROUND" };
  const PLANT_ROW_TYPE = { 0: "PLANTROW_DIRT", 1: "PLANTROW_NORMAL", 2: "PLANTROW_POOL", 3: "PLANTROW_HIGH_GROUND" };
  const BOARD_RESULT = { 0: "BOARDRESULT_NONE", 1: "BOARDRESULT_WON", 2: "BOARDRESULT_LOST", 3: "BOARDRESULT_RESTART", 4: "BOARDRESULT_QUIT", 5: "BOARDRESULT_QUIT_APP", 6: "BOARDRESULT_CHEAT" };
  const DEBUG_TEXT_MODE = { 0: "DEBUG_TEXT_NONE", 1: "DEBUG_TEXT_ZOMBIE_SPAWN", 2: "DEBUG_TEXT_MUSIC", 3: "DEBUG_TEXT_MEMORY", 4: "DEBUG_TEXT_COLLISION" };
  const HELM_TYPE = { 0: "HELMTYPE_NONE", 1: "HELMTYPE_TRAFFIC_CONE", 2: "HELMTYPE_PAIL", 3: "HELMTYPE_FOOTBALL", 4: "HELMTYPE_DIGGER", 5: "HELMTYPE_REDEYES", 6: "HELMTYPE_HEADBAND", 7: "HELMTYPE_BOBSLED", 8: "HELMTYPE_WALLNUT", 9: "HELMTYPE_TALLNUT" };
  const SHIELD_TYPE = { 0: "SHIELDTYPE_NONE", 1: "SHIELDTYPE_DOOR", 2: "SHIELDTYPE_NEWSPAPER", 3: "SHIELDTYPE_LADDER" };
  const ZOMBIE_HEIGHT = { 0: "HEIGHT_ZOMBIE_NORMAL", 1: "HEIGHT_IN_TO_POOL", 2: "HEIGHT_OUT_OF_POOL", 3: "HEIGHT_DRAGGED_UNDER", 4: "HEIGHT_UP_TO_HIGH_GROUND", 5: "HEIGHT_DOWN_OFF_HIGH_GROUND", 6: "HEIGHT_UP_LADDER", 7: "HEIGHT_FALLING", 8: "HEIGHT_IN_TO_CHIMNEY", 9: "HEIGHT_GETTING_BUNGEE_DROPPED", 10: "HEIGHT_ZOMBIQUARIUM" };
  const PLANT_SUBCLASS = { 0: "SUBCLASS_NORMAL", 1: "SUBCLASS_SHOOTER" };
  const PLANT_ON_BUNGEE_STATE = { 0: "NOT_ON_BUNGEE", 1: "GETTING_GRABBED_BY_BUNGEE", 2: "RISING_WITH_BUNGEE" };
  const COIN_MOTION = { 0: "COIN_MOTION_FROM_SKY", 1: "COIN_MOTION_FROM_SKY_SLOW", 2: "COIN_MOTION_FROM_PLANT", 3: "COIN_MOTION_COIN", 4: "COIN_MOTION_LAWNMOWER_COIN", 5: "COIN_MOTION_FROM_PRESENT", 6: "COIN_MOTION_FROM_BOSS" };
  const COIN_TYPE = {
    0: "COIN_NONE", 1: "COIN_SILVER", 2: "COIN_GOLD", 3: "COIN_DIAMOND", 4: "COIN_SUN",
    5: "COIN_SMALLSUN", 6: "COIN_LARGESUN", 7: "COIN_FINAL_SEED_PACKET", 8: "COIN_TROPHY",
    9: "COIN_SHOVEL", 10: "COIN_ALMANAC", 11: "COIN_CARKEYS", 12: "COIN_VASE",
    13: "COIN_WATERING_CAN", 14: "COIN_TACO", 15: "COIN_NOTE", 16: "COIN_USABLE_SEED_PACKET",
    17: "COIN_PRESENT_PLANT", 18: "COIN_AWARD_MONEY_BAG", 19: "COIN_AWARD_PRESENT",
    20: "COIN_AWARD_BAG_DIAMOND", 21: "COIN_AWARD_SILVER_SUNFLOWER", 22: "COIN_AWARD_GOLD_SUNFLOWER",
    23: "COIN_CHOCOLATE", 24: "COIN_AWARD_CHOCOLATE", 25: "COIN_PRESENT_MINIGAMES",
    26: "COIN_PRESENT_PUZZLE_MODE", 27: "COIN_PRESENT_SURVIVAL_MODE",
  };
  const GRID_ITEM_TYPE = { 0: "GRIDITEM_NONE", 1: "GRIDITEM_GRAVESTONE", 2: "GRIDITEM_CRATER", 3: "GRIDITEM_LADDER", 4: "GRIDITEM_PORTAL_CIRCLE", 5: "GRIDITEM_PORTAL_SQUARE", 6: "GRIDITEM_BRAIN", 7: "GRIDITEM_SCARY_POT", 8: "GRIDITEM_SQUIRREL", 9: "GRIDITEM_ZEN_TOOL", 10: "GRIDITEM_STINKY", 11: "GRIDITEM_RAKE", 12: "GRIDITEM_IZOMBIE_BRAIN" };
  const GRID_ITEM_STATE = { 0: "GRIDITEM_STATE_NORMAL", 1: "GRIDITEM_STATE_GRAVESTONE_SPECIAL", 2: "GRIDITEM_STATE_PORTAL_CLOSED", 3: "GRIDITEM_STATE_SCARY_POT_QUESTION", 4: "GRIDITEM_STATE_SCARY_POT_LEAF", 5: "GRIDITEM_STATE_SCARY_POT_ZOMBIE", 6: "GRIDITEM_STATE_SQUIRREL_WAITING", 7: "GRIDITEM_STATE_SQUIRREL_PEEKING", 8: "GRIDITEM_STATE_SQUIRREL_RUNNING_UP", 9: "GRIDITEM_STATE_SQUIRREL_RUNNING_DOWN", 10: "GRIDITEM_STATE_SQUIRREL_RUNNING_LEFT", 11: "GRIDITEM_STATE_SQUIRREL_RUNNING_RIGHT", 12: "GRIDITEM_STATE_SQUIRREL_CAUGHT", 13: "GRIDITEM_STATE_SQUIRREL_ZOMBIE", 14: "GRIDITEM_STATE_ZEN_TOOL_WATERING_CAN", 15: "GRIDITEM_STATE_ZEN_TOOL_FERTILIZER", 16: "GRIDITEM_STATE_ZEN_TOOL_BUG_SPRAY", 17: "GRIDITEM_STATE_ZEN_TOOL_PHONOGRAPH", 18: "GRIDITEM_STATE_ZEN_TOOL_GOLD_WATERING_CAN", 19: "GRIDITEM_STINKY_WALKING_LEFT", 20: "GRIDITEM_STINKY_TURNING_LEFT", 21: "GRIDITEM_STINKY_WALKING_RIGHT", 22: "GRIDITEM_STINKY_TURNING_RIGHT", 23: "GRIDITEM_STINKY_SLEEPING", 24: "GRIDITEM_STINKY_FALLING_ASLEEP", 25: "GRIDITEM_STINKY_WAKING_UP", 26: "GRIDITEM_STATE_RAKE_ATTRACTING", 27: "GRIDITEM_STATE_RAKE_WAITING", 28: "GRIDITEM_STATE_RAKE_TRIGGERED", 29: "GRIDITEM_STATE_BRAIN_SQUISHED" };
  const SCARY_POT_TYPE = { 0: "SCARYPOT_NONE", 1: "SCARYPOT_SEED", 2: "SCARYPOT_ZOMBIE", 3: "SCARYPOT_SUN" };
  const LAWN_MOWER_STATE = { 0: "MOWER_ROLLING_IN", 1: "MOWER_READY", 2: "MOWER_TRIGGERED", 3: "MOWER_SQUISHED" };
  const LAWN_MOWER_TYPE = { 0: "LAWNMOWER_LAWN", 1: "LAWNMOWER_POOL", 2: "LAWNMOWER_ROOF", 3: "LAWNMOWER_SUPER_MOWER" };
  const MOWER_HEIGHT = { 0: "MOWER_HEIGHT_LAND", 1: "MOWER_HEIGHT_DOWN_TO_POOL", 2: "MOWER_HEIGHT_IN_POOL", 3: "MOWER_HEIGHT_UP_TO_LAND" };
  const CURSOR_TYPE = { 0: "CURSOR_TYPE_NORMAL", 1: "CURSOR_TYPE_PLANT_FROM_BANK", 2: "CURSOR_TYPE_PLANT_FROM_USABLE_COIN", 3: "CURSOR_TYPE_PLANT_FROM_GLOVE", 4: "CURSOR_TYPE_PLANT_FROM_DUPLICATOR", 5: "CURSOR_TYPE_PLANT_FROM_WHEEL_BARROW", 6: "CURSOR_TYPE_SHOVEL", 7: "CURSOR_TYPE_HAMMER", 8: "CURSOR_TYPE_COBCANNON_TARGET", 9: "CURSOR_TYPE_WATERING_CAN", 10: "CURSOR_TYPE_FERTILIZER", 11: "CURSOR_TYPE_BUG_SPRAY", 12: "CURSOR_TYPE_PHONOGRAPH", 13: "CURSOR_TYPE_CHOCOLATE", 14: "CURSOR_TYPE_GLOVE", 15: "CURSOR_TYPE_MONEY_SIGN", 16: "CURSOR_TYPE_WHEEELBARROW", 17: "CURSOR_TYPE_TREE_FOOD" };
  const CHALLENGE_STATE = { 0: "STATECHALLENGE_NORMAL", 1: "STATECHALLENGE_BEGHOULED_MOVING", 2: "STATECHALLENGE_BEGHOULED_FALLING", 3: "STATECHALLENGE_BEGHOULED_NO_MATCHES", 4: "STATECHALLENGE_SLOT_MACHINE_ROLLING", 5: "STATECHALLENGE_STORM_FLASH_1", 6: "STATECHALLENGE_STORM_FLASH_2", 7: "STATECHALLENGE_STORM_FLASH_3", 8: "STATECHALLENGE_ZEN_FADING", 9: "STATECHALLENGE_SCARY_POTTER_MALLETING", 10: "STATECHALLENGE_LAST_STAND_ONSLAUGHT", 11: "STATECHALLENGE_TREE_JUST_GREW", 12: "STATECHALLENGE_TREE_GIVE_WISDOM", 13: "STATECHALLENGE_TREE_WAITING_TO_BABBLE", 14: "STATECHALLENGE_TREE_BABBLING" };
  const PROJECTILE_MOTION = { 0: "MOTION_STRAIGHT", 1: "MOTION_LOBBED", 2: "MOTION_THREEPEATER", 3: "MOTION_BEE", 4: "MOTION_BEE_BACKWARDS", 5: "MOTION_PUFF", 6: "MOTION_BACKWARDS", 7: "MOTION_STAR", 8: "MOTION_FLOAT_OVER", 9: "MOTION_HOMING" };
  const PROJECTILE_TYPE = { 0: "PROJECTILE_PEA", 1: "PROJECTILE_SNOWPEA", 2: "PROJECTILE_CABBAGE", 3: "PROJECTILE_MELON", 4: "PROJECTILE_PUFF", 5: "PROJECTILE_WINTERMELON", 6: "PROJECTILE_FIREBALL", 7: "PROJECTILE_STAR", 8: "PROJECTILE_SPIKE", 9: "PROJECTILE_BASKETBALL", 10: "PROJECTILE_KERNEL", 11: "PROJECTILE_COBBIG", 12: "PROJECTILE_BUTTER", 13: "PROJECTILE_ZOMBIE_PEA" };
  const MUSIC_TUNE = { "-1": "MUSIC_TUNE_NONE", 1: "MUSIC_TUNE_DAY_GRASSWALK", 2: "MUSIC_TUNE_NIGHT_MOONGRAINS", 3: "MUSIC_TUNE_POOL_WATERYGRAVES", 4: "MUSIC_TUNE_FOG_RIGORMORMIST", 5: "MUSIC_TUNE_ROOF_GRAZETHEROOF", 6: "MUSIC_TUNE_CHOOSE_YOUR_SEEDS", 7: "MUSIC_TUNE_TITLE_CRAZY_DAVE_MAIN_THEME", 8: "MUSIC_TUNE_ZEN_GARDEN", 9: "MUSIC_TUNE_PUZZLE_CEREBRAWL", 10: "MUSIC_TUNE_MINIGAME_LOONBOON", 11: "MUSIC_TUNE_CONVEYER", 12: "MUSIC_TUNE_FINAL_BOSS_BRAINIAC_MANIAC", 13: "MUSIC_TUNE_CREDITS_ZOMBIES_ON_YOUR_LAWN" };
  const MUSIC_FILE = { "-1": "MUSIC_FILE_NONE", 1: "MUSIC_FILE_MAIN_MUSIC", 2: "MUSIC_FILE_DRUMS", 3: "MUSIC_FILE_HIHATS", 4: "MUSIC_FILE_CREDITS_ZOMBIES_ON_YOUR_LAWN" };
  const MUSIC_BURST_STATE = { 0: "MUSIC_BURST_OFF", 1: "MUSIC_BURST_STARTING", 2: "MUSIC_BURST_ON", 3: "MUSIC_BURST_FINISHING" };
  const MUSIC_DRUMS_STATE = { 0: "MUSIC_DRUMS_OFF", 1: "MUSIC_DRUMS_ON_QUEUED", 2: "MUSIC_DRUMS_ON", 3: "MUSIC_DRUMS_OFF_QUEUED", 4: "MUSIC_DRUMS_FADING" };
  const GARDEN_TYPE = { 0: "GARDEN_MAIN", 1: "GARDEN_MUSHROOM", 2: "GARDEN_WHEELBARROW", 3: "GARDEN_AQUARIUM" };
  const POTTED_PLANT_AGE = { 0: "PLANTAGE_SPROUT", 1: "PLANTAGE_SMALL", 2: "PLANTAGE_MEDIUM", 3: "PLANTAGE_FULL" };
  const POTTED_PLANT_NEED = { 0: "PLANTNEED_NONE", 1: "PLANTNEED_WATER", 2: "PLANTNEED_FERTILIZER", 3: "PLANTNEED_BUGSPRAY", 4: "PLANTNEED_PHONOGRAPH" };
  const FACING_DIRECTION = { 0: "FACING_RIGHT", 1: "FACING_LEFT" };
  const DRAW_VARIATION = { 0: "VARIATION_NORMAL", 1: "VARIATION_IMITATER", 2: "VARIATION_MARIGOLD_WHITE", 3: "VARIATION_MARIGOLD_MAGENTA", 4: "VARIATION_MARIGOLD_ORANGE", 5: "VARIATION_MARIGOLD_PINK", 6: "VARIATION_MARIGOLD_LIGHT_BLUE", 7: "VARIATION_MARIGOLD_RED", 8: "VARIATION_MARIGOLD_BLUE", 9: "VARIATION_MARIGOLD_VIOLET", 10: "VARIATION_MARIGOLD_LAVENDER", 11: "VARIATION_MARIGOLD_YELLOW", 12: "VARIATION_MARIGOLD_LIGHT_GREEN", 13: "VARIATION_ZEN_GARDEN", 14: "VARIATION_ZEN_GARDEN_WATER", 15: "VARIATION_SPROUT_NO_FLOWER", 16: "VARIATION_IMITATER_LESS", 17: "VARIATION_AQUARIUM" };

  const ZOMBIE_PHASE = {
    0: "PHASE_ZOMBIE_NORMAL", 1: "PHASE_ZOMBIE_DYING", 2: "PHASE_ZOMBIE_BURNED", 3: "PHASE_ZOMBIE_MOWERED",
    4: "PHASE_BUNGEE_DIVING", 5: "PHASE_BUNGEE_DIVING_SCREAMING", 6: "PHASE_BUNGEE_AT_BOTTOM",
    7: "PHASE_BUNGEE_GRABBING", 8: "PHASE_BUNGEE_RISING", 9: "PHASE_BUNGEE_HIT_OUCHY",
    10: "PHASE_BUNGEE_CUTSCENE", 11: "PHASE_POLEVAULTER_PRE_VAULT", 12: "PHASE_POLEVAULTER_IN_VAULT",
    13: "PHASE_POLEVAULTER_POST_VAULT", 14: "PHASE_RISING_FROM_GRAVE", 15: "PHASE_JACK_IN_THE_BOX_RUNNING",
    16: "PHASE_JACK_IN_THE_BOX_POPPING", 17: "PHASE_BOBSLED_SLIDING", 18: "PHASE_BOBSLED_BOARDING",
    19: "PHASE_BOBSLED_CRASHING", 20: "PHASE_POGO_BOUNCING", 21: "PHASE_POGO_HIGH_BOUNCE_1",
    22: "PHASE_POGO_HIGH_BOUNCE_2", 23: "PHASE_POGO_HIGH_BOUNCE_3", 24: "PHASE_POGO_HIGH_BOUNCE_4",
    25: "PHASE_POGO_HIGH_BOUNCE_5", 26: "PHASE_POGO_HIGH_BOUNCE_6", 27: "PHASE_POGO_FORWARD_BOUNCE_2",
    28: "PHASE_POGO_FORWARD_BOUNCE_7", 29: "PHASE_NEWSPAPER_READING", 30: "PHASE_NEWSPAPER_MADDENING",
    31: "PHASE_NEWSPAPER_MAD", 32: "PHASE_DIGGER_TUNNELING", 33: "PHASE_DIGGER_RISING",
    34: "PHASE_DIGGER_TUNNELING_PAUSE_WITHOUT_AXE", 35: "PHASE_DIGGER_RISE_WITHOUT_AXE",
    36: "PHASE_DIGGER_STUNNED", 37: "PHASE_DIGGER_WALKING", 38: "PHASE_DIGGER_WALKING_WITHOUT_AXE",
    39: "PHASE_DIGGER_CUTSCENE", 40: "PHASE_DANCER_DANCING_IN", 41: "PHASE_DANCER_SNAPPING_FINGERS",
    42: "PHASE_DANCER_SNAPPING_FINGERS_WITH_LIGHT", 43: "PHASE_DANCER_SNAPPING_FINGERS_HOLD",
    44: "PHASE_DANCER_DANCING_LEFT", 45: "PHASE_DANCER_WALK_TO_RAISE", 46: "PHASE_DANCER_RAISE_LEFT_1",
    47: "PHASE_DANCER_RAISE_RIGHT_1", 48: "PHASE_DANCER_RAISE_LEFT_2", 49: "PHASE_DANCER_RAISE_RIGHT_2",
    50: "PHASE_DANCER_RISING", 51: "PHASE_DOLPHIN_WALKING", 52: "PHASE_DOLPHIN_INTO_POOL",
    53: "PHASE_DOLPHIN_RIDING", 54: "PHASE_DOLPHIN_IN_JUMP", 55: "PHASE_DOLPHIN_WALKING_IN_POOL",
    56: "PHASE_DOLPHIN_WALKING_WITHOUT_DOLPHIN", 57: "PHASE_SNORKEL_WALKING", 58: "PHASE_SNORKEL_INTO_POOL",
    59: "PHASE_SNORKEL_WALKING_IN_POOL", 60: "PHASE_SNORKEL_UP_TO_EAT", 61: "PHASE_SNORKEL_EATING_IN_POOL",
    62: "PHASE_SNORKEL_DOWN_FROM_EAT", 63: "PHASE_ZOMBIQUARIUM_ACCEL", 64: "PHASE_ZOMBIQUARIUM_DRIFT",
    65: "PHASE_ZOMBIQUARIUM_BACK_AND_FORTH", 66: "PHASE_ZOMBIQUARIUM_BITE", 67: "PHASE_CATAPULT_LAUNCHING",
    68: "PHASE_CATAPULT_RELOADING", 69: "PHASE_GARGANTUAR_THROWING", 70: "PHASE_GARGANTUAR_SMASHING",
    71: "PHASE_IMP_GETTING_THROWN", 72: "PHASE_IMP_LANDING", 73: "PHASE_BALLOON_FLYING",
    74: "PHASE_BALLOON_POPPING", 75: "PHASE_BALLOON_WALKING", 76: "PHASE_LADDER_CARRYING",
    77: "PHASE_LADDER_PLACING", 78: "PHASE_BOSS_ENTER", 79: "PHASE_BOSS_IDLE", 80: "PHASE_BOSS_SPAWNING",
    81: "PHASE_BOSS_STOMPING", 82: "PHASE_BOSS_BUNGEES_ENTER", 83: "PHASE_BOSS_BUNGEES_DROP",
    84: "PHASE_BOSS_BUNGEES_LEAVE", 85: "PHASE_BOSS_DROP_RV", 86: "PHASE_BOSS_HEAD_ENTER",
    87: "PHASE_BOSS_HEAD_IDLE_BEFORE_SPIT", 88: "PHASE_BOSS_HEAD_IDLE_AFTER_SPIT",
    89: "PHASE_BOSS_HEAD_SPIT", 90: "PHASE_BOSS_HEAD_LEAVE", 91: "PHASE_YETI_RUNNING",
    92: "PHASE_SQUASH_PRE_LAUNCH", 93: "PHASE_SQUASH_RISING", 94: "PHASE_SQUASH_FALLING",
    95: "PHASE_SQUASH_DONE_FALLING",
  };

  const PLANT_STATE = {
    0: "STATE_NOTREADY", 1: "STATE_READY", 2: "STATE_DOINGSPECIAL", 3: "STATE_SQUASH_LOOK",
    4: "STATE_SQUASH_PRE_LAUNCH", 5: "STATE_SQUASH_RISING", 6: "STATE_SQUASH_FALLING",
    7: "STATE_SQUASH_DONE_FALLING", 8: "STATE_GRAVEBUSTER_LANDING", 9: "STATE_GRAVEBUSTER_EATING",
    10: "STATE_CHOMPER_BITING", 11: "STATE_CHOMPER_BITING_GOT_ONE", 12: "STATE_CHOMPER_BITING_MISSED",
    13: "STATE_CHOMPER_DIGESTING", 14: "STATE_CHOMPER_SWALLOWING", 15: "STATE_POTATO_RISING",
    16: "STATE_POTATO_ARMED", 17: "STATE_POTATO_MASHED", 18: "STATE_SPIKEWEED_ATTACKING",
    19: "STATE_SPIKEWEED_ATTACKING_2", 20: "STATE_SCAREDYSHROOM_LOWERING", 21: "STATE_SCAREDYSHROOM_SCARED",
    22: "STATE_SCAREDYSHROOM_RAISING", 23: "STATE_SUNSHROOM_SMALL", 24: "STATE_SUNSHROOM_GROWING",
    25: "STATE_SUNSHROOM_BIG", 26: "STATE_MAGNETSHROOM_SUCKING", 27: "STATE_MAGNETSHROOM_CHARGING",
    28: "STATE_BOWLING_UP", 29: "STATE_BOWLING_DOWN", 30: "STATE_CACTUS_LOW", 31: "STATE_CACTUS_RISING",
    32: "STATE_CACTUS_HIGH", 33: "STATE_CACTUS_LOWERING", 34: "STATE_TANGLEKELP_GRABBING",
    35: "STATE_COBCANNON_ARMING", 36: "STATE_COBCANNON_LOADING", 37: "STATE_COBCANNON_READY",
    38: "STATE_COBCANNON_FIRING", 39: "STATE_KERNELPULT_BUTTER", 40: "STATE_UMBRELLA_TRIGGERED",
    41: "STATE_UMBRELLA_REFLECTING", 42: "STATE_IMITATER_MORPHING", 43: "STATE_ZEN_GARDEN_WATERED",
    44: "STATE_ZEN_GARDEN_NEEDY", 45: "STATE_ZEN_GARDEN_HAPPY", 46: "STATE_MARIGOLD_ENDING",
    47: "STATE_FLOWERPOT_INVULNERABLE", 48: "STATE_LILYPAD_INVULNERABLE",
  };

  const TUTORIAL_STATE = {
    0: "TUTORIAL_OFF", 1: "TUTORIAL_LEVEL_1_PICK_UP_PEASHOOTER", 2: "TUTORIAL_LEVEL_1_PLANT_PEASHOOTER",
    3: "TUTORIAL_LEVEL_1_REFRESH_PEASHOOTER", 4: "TUTORIAL_LEVEL_1_COMPLETED",
    5: "TUTORIAL_LEVEL_2_PICK_UP_SUNFLOWER", 6: "TUTORIAL_LEVEL_2_PLANT_SUNFLOWER",
    7: "TUTORIAL_LEVEL_2_REFRESH_SUNFLOWER", 8: "TUTORIAL_LEVEL_2_COMPLETED",
    9: "TUTORIAL_MORESUN_PICK_UP_SUNFLOWER", 10: "TUTORIAL_MORESUN_PLANT_SUNFLOWER",
    11: "TUTORIAL_MORESUN_REFRESH_SUNFLOWER", 12: "TUTORIAL_MORESUN_COMPLETED",
    13: "TUTORIAL_SLOT_MACHINE_PULL", 14: "TUTORIAL_SLOT_MACHINE_COMPLETED",
    15: "TUTORIAL_SHOVEL_PICKUP", 16: "TUTORIAL_SHOVEL_DIG", 17: "TUTORIAL_SHOVEL_KEEP_DIGGING",
    18: "TUTORIAL_SHOVEL_COMPLETED", 19: "TUTORIAL_ZOMBIQUARIUM_BUY_SNORKEL",
    20: "TUTORIAL_ZOMBIQUARIUM_BOUGHT_SNORKEL", 21: "TUTORIAL_ZOMBIQUARIUM_CLICK_TROPHY",
    22: "TUTORIAL_ZEN_GARDEN_PICKUP_WATER", 23: "TUTORIAL_ZEN_GARDEN_WATER_PLANT",
    24: "TUTORIAL_ZEN_GARDEN_KEEP_WATERING", 25: "TUTORIAL_ZEN_GARDEN_VISIT_STORE",
    26: "TUTORIAL_ZEN_GARDEN_FERTILIZE_PLANTS", 27: "TUTORIAL_ZEN_GARDEN_COMPLETED",
    28: "TUTORIAL_WHACK_A_ZOMBIE_BEFORE_PICK_SEED", 29: "TUTORIAL_WHACK_A_ZOMBIE_PICK_SEED",
    30: "TUTORIAL_WHACK_A_ZOMBIE_COMPLETED",
  };

  /* ------------------------------------------------------------------ */
  /* Schema engine                                                      */
  /* ------------------------------------------------------------------ */

  function fieldSize(kind, arg) {
    switch (kind) {
      case "bool": return 1;
      case "i32": case "u32": case "f32": case "enum": return 4;
      case "i64": return 8;
      case "rect": return 16;
      case "i32s": case "u32s": case "f32s": return arg * 4;
      case "bools": return arg;
      case "enums": return arg[0] * 4;
      case "magnet": return 5 * 20;
      case "potted": return 88;
      case "trail": return 12 * 12;
      case "smooth": return arg * 16;
      case "waves": return MAX_WAVES * MAX_ZOMBIES_IN_WAVE * 4;
      case "bytes": return arg;
      default: throw new Error("未知字段类型: " + kind);
    }
  }

  function makeSchema(defs) {
    let offset = 0;
    return defs.map(([key, kind, arg, common, label]) => {
      const size = fieldSize(kind, arg);
      const spec = { key, kind, arg, common: !!common, label: label || key, offset, size };
      offset += size;
      return spec;
    });
  }

  function readFieldValue(spec, bytes, offset = 0) {
    const r = new Reader(bytes.subarray(offset));
    switch (spec.kind) {
      case "bool": return r.u8() !== 0;
      case "i32": return r.i32();
      case "u32": return r.u32();
      case "i64": return r.i64();
      case "f32": return r.f32();
      case "enum": return r.i32();
      case "i32s": { const a = []; for (let i = 0; i < spec.arg; i++) a.push(r.i32()); return a; }
      case "u32s": { const a = []; for (let i = 0; i < spec.arg; i++) a.push(r.u32()); return a; }
      case "f32s": { const a = []; for (let i = 0; i < spec.arg; i++) a.push(r.f32()); return a; }
      case "bools": { const a = []; for (let i = 0; i < spec.arg; i++) a.push(r.u8() !== 0); return a; }
      case "enums": { const a = []; for (let i = 0; i < spec.arg[0]; i++) a.push(r.i32()); return a; }
      case "rect": return { x: r.i32(), y: r.i32(), width: r.i32(), height: r.i32() };
      case "magnet": {
        const a = [];
        for (let i = 0; i < 5; i++) a.push({ posX: r.f32(), posY: r.f32(), destOffsetX: r.f32(), destOffsetY: r.f32(), itemType: r.i32() });
        return a;
      }
      case "potted": return readPottedPlant(r.bytes(88));
      case "trail": {
        const a = [];
        for (let i = 0; i < 12; i++) a.push([r.f32(), r.f32(), r.f32()]);
        return a;
      }
      case "smooth": {
        const a = [];
        for (let i = 0; i < spec.arg; i++) a.push([r.i32(), r.f32(), r.f32(), r.f32()]);
        return a;
      }
      case "bytes": return r.bytes(spec.arg);
      default: return null;
    }
  }

  function writeFieldValue(spec, value, bytes, offset = 0) {
    const w = new Writer();
    const asInt = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error("请输入有效数字");
      return Math.trunc(n);
    };
    switch (spec.kind) {
      case "bool": w.u8(value ? 1 : 0); break;
      case "i32": w.i32(asInt(value)); break;
      case "u32": w.u32(asInt(value)); break;
      case "i64": w.i64(asInt(value)); break;
      case "f32": w.f32(Number(value)); break;
      case "enum": w.i32(asInt(value)); break;
      case "rect": w.i32(asInt(value.x)); w.i32(asInt(value.y)); w.i32(asInt(value.width)); w.i32(asInt(value.height)); break;
      case "i32s": case "u32s": case "f32s": case "bools": case "enums": case "magnet": case "trail": case "smooth":
        throw new Error("此字段不支持直接编辑");
      case "bytes": w.raw(value); break;
      default: throw new Error("未知字段类型: " + spec.kind);
    }
    const out = w.toBytes();
    if (out.length !== spec.size) throw new Error("字段长度不匹配");
    bytes.set(out, offset);
  }

  const BOARD_DEFS = [
    [1, "paused", "bool", null, true, "暂停"],
    [2, "grid_square_type", "enums", [54, GRID_SQUARE_TYPE], false],
    [3, "grid_cel_look", "i32s", 54, false],
    [4, "grid_cel_offset", "i32s", 108, false],
    [5, "grid_cel_fog", "i32s", 63, false],
    [6, "enable_gravestones", "bool", null, false, "启用墓碑"],
    [7, "special_gravestone_x", "i32", null, false],
    [8, "special_gravestone_y", "i32", null, false],
    [9, "fog_offset", "f32", null, false],
    [10, "fog_blown_countdown", "i32", null, false],
    [11, "plant_row", "enums", [6, PLANT_ROW_TYPE], false],
    [12, "wave_row_got_lawnmowered", "i32s", 6, false],
    [13, "bonus_lawnmowers_remaining", "i32", null, true, "剩余额外割草机"],
    [14, "ice_min_x", "i32s", 6, false],
    [15, "ice_timer", "i32s", 6, false],
    [16, "ice_particle_id", "u32s", 6, false],
    [17, "row_picking_array", "smooth", 6, false],
    [18, "waves", "waves", null, true, "僵尸波次"],
    [19, "zombie_allowed", "bools", 100, false],
    [20, "sun_countdown", "i32", null, false, "阳光倒计时"],
    [21, "num_suns_fallen", "i32", null, false, "已掉落阳光数"],
    [22, "shake_counter", "i32", null, false],
    [23, "shake_amount_x", "i32", null, false],
    [24, "shake_amount_y", "i32", null, false],
    [25, "background", "enum", BACKGROUND_TYPE, true, "场景"],
    [26, "level", "i32", null, true, "关卡"],
    [27, "sod_position", "i32", null, false],
    [28, "prev_mouse_x", "i32", null, false],
    [29, "prev_mouse_y", "i32", null, false],
    [30, "sun_money", "i32", null, true, "当前阳光"],
    [31, "num_waves", "i32", null, true, "总波数"],
    [32, "main_counter", "u32", null, false],
    [33, "effect_counter", "u32", null, false],
    [34, "draw_count", "u32", null, false],
    [35, "rise_from_grave_counter", "i32", null, true, "墓碑升起计数"],
    [36, "out_of_money_counter", "i32", null, false],
    [37, "current_wave", "i32", null, true, "当前波次"],
    [38, "total_spawned_waves", "i32", null, true, "已生成波数"],
    [39, "tutorial_state", "enum", TUTORIAL_STATE, false, "教程状态"],
    [40, "tutorial_particle_id", "u32", null, false],
    [41, "tutorial_timer", "i32", null, false],
    [42, "last_bungee_wave", "i32", null, false],
    [43, "zombie_health_to_next_wave", "i32", null, false, "下一波所需僵尸血量"],
    [44, "zombie_health_wave_start", "i32", null, false],
    [45, "zombie_countdown", "i32", null, true, "僵尸倒计时"],
    [46, "zombie_countdown_start", "i32", null, true, "僵尸倒计时初值"],
    [47, "huge_wave_countdown", "i32", null, false, "大波倒计时"],
    [48, "help_displayed", "bools", 66, false],
    [49, "help_index", "i32", null, false],
    [50, "final_boss_killed", "bool", null, false, "最终 Boss 已击杀"],
    [51, "show_shovel", "bool", null, false, "显示铲子"],
    [52, "coin_bank_fade_count", "i32", null, false],
    [53, "debug_text_mode", "enum", DEBUG_TEXT_MODE, false],
    [54, "level_complete", "bool", null, false, "关卡完成"],
    [55, "board_fade_out_counter", "i32", null, false],
    [56, "next_survival_stage_counter", "i32", null, false],
    [57, "score_next_mower_counter", "i32", null, false],
    [58, "level_award_spawned", "bool", null, false],
    [59, "progress_meter_width", "i32", null, false],
    [60, "flag_raise_counter", "i32", null, false],
    [61, "ice_trap_counter", "i32", null, false],
    [62, "board_rand_seed", "i32", null, false, "随机种子"],
    [63, "pool_sparkly_particle_id", "u32", null, false],
    [64, "fwoosh_id", "u32s", 72, false],
    [65, "fwoosh_countdown", "i32", null, false],
    [66, "time_stop_counter", "i32", null, false],
    [67, "dropped_first_coin", "bool", null, false],
    [68, "final_wave_sound_counter", "i32", null, false],
    [69, "cob_cannon_cursor_delay_counter", "i32", null, false],
    [70, "cob_cannon_mouse_x", "i32", null, false],
    [71, "cob_cannon_mouse_y", "i32", null, false],
    [72, "killed_yeti", "bool", null, false, "击杀雪人僵尸"],
    [73, "mustache_mode", "bool", null, true, "胡须模式"],
    [74, "super_mower_mode", "bool", null, true, "超级割草机"],
    [75, "future_mode", "bool", null, true, "未来模式"],
    [76, "pinata_mode", "bool", null, true, "皮纳塔模式"],
    [77, "dance_mode", "bool", null, true, "舞蹈模式"],
    [78, "daisy_mode", "bool", null, true, "雏菊模式"],
    [79, "sukhbir_mode", "bool", null, true, "Sukhbir 模式"],
    [80, "prev_board_result", "enum", BOARD_RESULT, false, "上一局结果"],
    [81, "triggered_lawnmowers", "i32", null, false],
    [82, "play_time_active_level", "u32", null, false],
    [83, "play_time_inactive_level", "u32", null, false],
    [84, "max_sun_plants", "i32", null, false],
    [85, "start_draw_time", "i64", null, false],
    [86, "interval_draw_time", "i64", null, false],
    [87, "interval_draw_count_start", "u32", null, false],
    [88, "min_fps", "f32", null, false],
    [89, "preload_time", "i32", null, false],
    [90, "game_id", "i64", null, false],
    [91, "graves_cleared", "u32", null, false],
    [92, "plants_eaten", "u32", null, false],
    [93, "plants_shoveled", "u32", null, false],
    [94, "pea_shooter_used", "bool", null, false],
    [95, "catapult_plants_used", "bool", null, false],
    [96, "mushroom_and_coffee_beans_only", "bool", null, false],
    [97, "mushrooms_used", "bool", null, false],
    [98, "level_coins_collected", "u32", null, false],
    [99, "gargantuars_kills_by_corn_cob", "u32", null, false],
    [100, "coins_collected", "u32", null, false],
    [101, "diamonds_collected", "u32", null, false],
    [102, "potted_plants_collected", "u32", null, false],
    [103, "chocolate_collected", "u32", null, false],
  ];

  const BOARD_SCHEMA = BOARD_DEFS.map(([id, key, kind, arg, common, label]) =>
    ({ id, key, kind, arg, common: !!common, label: label || key, size: fieldSize(kind, arg) }));
  const BOARD_BY_ID = new Map(BOARD_SCHEMA.map((spec) => [spec.id, spec]));

  const ZOMBIE_SCHEMA = makeSchema([
    ["zombie_type", "enum", ZOMBIE_TYPE, true, "僵尸类型"],
    ["zombie_phase", "enum", ZOMBIE_PHASE, false, "阶段"],
    ["pos_x", "f32", null, true, "X"],
    ["pos_y", "f32", null, true, "Y"],
    ["vel_x", "f32", null, false],
    ["anim_counter", "i32", null, false],
    ["groan_counter", "i32", null, false],
    ["anim_ticks_per_frame", "i32", null, false],
    ["anim_frames", "i32", null, false],
    ["frame", "i32", null, false],
    ["prev_frame", "i32", null, false],
    ["variant", "bool", null, false],
    ["is_eating", "bool", null, true, "正在啃食"],
    ["just_got_shot_counter", "i32", null, false],
    ["shield_just_got_shot_counter", "i32", null, false],
    ["shield_recoil_counter", "i32", null, false],
    ["zombie_age", "i32", null, false],
    ["zombie_height", "enum", ZOMBIE_HEIGHT, false],
    ["phase_counter", "i32", null, false],
    ["from_wave", "i32", null, true, "所属波次"],
    ["dropped_loot", "bool", null, false],
    ["zombie_fade", "i32", null, false],
    ["flat_tires", "bool", null, false],
    ["use_ladder_col", "i32", null, false],
    ["target_col", "i32", null, false],
    ["altitude", "f32", null, false],
    ["hit_umbrella", "bool", null, false],
    ["zombie_rect", "rect", null, false],
    ["zombie_attack_rect", "rect", null, false],
    ["chilled_counter", "i32", null, true, "冰冻"],
    ["buttered_counter", "i32", null, true, "黄油"],
    ["ice_trap_counter", "i32", null, true, "冰道"],
    ["mind_controlled", "bool", null, true, "被魅惑"],
    ["blowing_away", "bool", null, false],
    ["has_head", "bool", null, true, "有头"],
    ["has_arm", "bool", null, true, "有手"],
    ["has_object", "bool", null, false],
    ["in_pool", "bool", null, false],
    ["on_high_ground", "bool", null, false],
    ["yucky_face", "bool", null, false],
    ["yucky_face_counter", "i32", null, false],
    ["helm_type", "enum", HELM_TYPE, true, "头盔"],
    ["body_health", "i32", null, true, "本体血量"],
    ["body_max_health", "i32", null, true, "本体最大血量"],
    ["helm_health", "i32", null, true, "头盔血量"],
    ["helm_max_health", "i32", null, true, "头盔最大血量"],
    ["shield_type", "enum", SHIELD_TYPE, true, "护盾"],
    ["shield_health", "i32", null, true, "护盾血量"],
    ["shield_max_health", "i32", null, true, "护盾最大血量"],
    ["flying_health", "i32", null, false],
    ["flying_max_health", "i32", null, false],
    ["dead", "bool", null, true, "已死亡"],
    ["related_zombie_id", "u32", null, false],
    ["follower_zombie_ids", "u32s", 4, false],
    ["playing_song", "bool", null, false],
    ["particle_offset_x", "i32", null, false],
    ["particle_offset_y", "i32", null, false],
    ["attachment_id", "i32", null, false],
    ["summon_counter", "i32", null, false],
    ["body_reanim_id", "u32", null, false],
    ["scale_zombie", "f32", null, false],
    ["vel_z", "f32", null, false],
    ["original_anim_rate", "f32", null, false],
    ["target_plant_id", "u32", null, false],
    ["boss_mode", "i32", null, false],
    ["target_row", "i32", null, false],
    ["boss_bungee_counter", "i32", null, false],
    ["boss_stomp_counter", "i32", null, false],
    ["boss_head_counter", "i32", null, false],
    ["boss_fireball_reanim_id", "u32", null, false],
    ["special_head_reanim_id", "u32", null, false],
    ["fireball_row", "i32", null, false],
    ["is_fireball", "bool", null, false],
    ["mowered_reanim_id", "u32", null, false],
    ["last_portal_x", "i32", null, false],
    ["zombatar_head_reanim_id", "u32", null, false],
  ]);

  const PLANT_SCHEMA = makeSchema([
    ["seed_type", "enum", SEED_TYPE, true, "植物类型"],
    ["col", "i32", null, true, "列"],
    ["anim_counter", "i32", null, false],
    ["frame", "i32", null, false],
    ["frame_length", "i32", null, false],
    ["num_frames", "i32", null, false],
    ["state", "enum", PLANT_STATE, true, "状态"],
    ["plant_health", "i32", null, true, "血量"],
    ["plant_max_health", "i32", null, true, "最大血量"],
    ["subclass", "enum", PLANT_SUBCLASS, false],
    ["disappear_countdown", "i32", null, false],
    ["do_special_countdown", "i32", null, false],
    ["state_countdown", "i32", null, false],
    ["launch_counter", "i32", null, false],
    ["launch_rate", "i32", null, false],
    ["plant_rect", "rect", null, false],
    ["plant_attack_rect", "rect", null, false],
    ["target_x", "i32", null, false],
    ["target_y", "i32", null, false],
    ["start_row", "i32", null, false],
    ["particle_id", "u32", null, false],
    ["shooting_counter", "i32", null, false],
    ["body_reanim_id", "u32", null, false],
    ["head_reanim_id", "u32", null, false],
    ["head_reanim_id2", "u32", null, false],
    ["head_reanim_id3", "u32", null, false],
    ["blink_reanim_id", "u32", null, false],
    ["light_reanim_id", "u32", null, false],
    ["sleeping_reanim_id", "u32", null, false],
    ["blink_countdown", "i32", null, false],
    ["recently_eaten_countdown", "i32", null, false],
    ["eaten_flash_countdown", "i32", null, false],
    ["beghouled_flash_countdown", "i32", null, false],
    ["shake_offset_x", "f32", null, false],
    ["shake_offset_y", "f32", null, false],
    ["magnet_items", "magnet", null, false],
    ["target_zombie_id", "u32", null, false],
    ["wake_up_counter", "i32", null, true, "唤醒计时"],
    ["on_bungee_state", "enum", PLANT_ON_BUNGEE_STATE, false],
    ["imitater_type", "enum", SEED_TYPE, true, "模仿类型"],
    ["potted_plant_index", "i32", null, false],
    ["anim_ping", "bool", null, false],
    ["dead", "bool", null, true, "已死亡"],
    ["squished", "bool", null, true, "被压扁"],
    ["is_asleep", "bool", null, true, "睡眠"],
    ["is_on_board", "bool", null, true, "在场上"],
    ["highlighted", "bool", null, false],
  ]);

  const PROJECTILE_SCHEMA = makeSchema([
    ["frame", "i32", null, false],
    ["num_frames", "i32", null, false],
    ["anim_counter", "i32", null, false],
    ["pos_x", "f32", null, true, "X"],
    ["pos_y", "f32", null, true, "Y"],
    ["pos_z", "f32", null, true, "Z"],
    ["vel_x", "f32", null, false],
    ["vel_y", "f32", null, false],
    ["vel_z", "f32", null, false],
    ["acc_z", "f32", null, false],
    ["shadow_y", "f32", null, false],
    ["dead", "bool", null, true, "已消失"],
    ["anim_ticks_per_frame", "i32", null, false],
    ["motion_type", "enum", PROJECTILE_MOTION, true, "运动方式"],
    ["projectile_type", "enum", PROJECTILE_TYPE, true, "子弹类型"],
    ["projectile_age", "i32", null, false],
    ["click_backoff_counter", "i32", null, false],
    ["rotation", "f32", null, false],
    ["rotation_speed", "f32", null, false],
    ["on_high_ground", "bool", null, false],
    ["damage_range_flags", "i32", null, false],
    ["hit_torchwood_grid_x", "i32", null, false],
    ["attachment_id", "i32", null, false],
    ["cob_target_x", "f32", null, false],
    ["cob_target_row", "i32", null, false],
    ["target_zombie_id", "u32", null, false],
    ["last_portal_x", "i32", null, false],
  ]);

  const COIN_SCHEMA = makeSchema([
    ["pos_x", "f32", null, true, "X"],
    ["pos_y", "f32", null, true, "Y"],
    ["vel_x", "f32", null, false],
    ["vel_y", "f32", null, false],
    ["scale", "f32", null, false],
    ["dead", "bool", null, true, "已消失"],
    ["fade_count", "i32", null, false],
    ["collect_x", "f32", null, false],
    ["collect_y", "f32", null, false],
    ["ground_y", "i32", null, false],
    ["coin_age", "i32", null, false],
    ["is_being_collected", "bool", null, false],
    ["disappear_counter", "i32", null, true, "消失倒计时"],
    ["type", "enum", COIN_TYPE, true, "金币类型"],
    ["coin_motion", "enum", COIN_MOTION, false],
    ["attachment_id", "i32", null, false],
    ["collection_distance", "f32", null, false],
    ["usable_seed_type", "enum", SEED_TYPE, true, "可用植物"],
    ["potted_plant_spec", "potted", null, false],
    ["needs_bouncy_arrow", "bool", null, false],
    ["has_bouncy_arrow", "bool", null, false],
    ["hit_ground", "bool", null, false],
    ["times_dropped", "i32", null, false],
  ]);

  const MOWER_SCHEMA = makeSchema([
    ["pos_x", "f32", null, true, "X"],
    ["pos_y", "f32", null, false],
    ["render_order", "i32", null, false],
    ["row", "i32", null, true, "行"],
    ["anim_ticks_per_frame", "i32", null, false],
    ["reanim_id", "u32", null, false],
    ["chomp_counter", "i32", null, false],
    ["rolling_in_counter", "i32", null, false],
    ["squished_counter", "i32", null, false],
    ["mower_state", "enum", LAWN_MOWER_STATE, true, "状态"],
    ["dead", "bool", null, true, "已消失"],
    ["visible", "bool", null, false],
    ["mower_type", "enum", LAWN_MOWER_TYPE, true, "类型"],
    ["altitude", "f32", null, false],
    ["mower_height", "enum", MOWER_HEIGHT, false],
    ["last_portal_x", "i32", null, false],
  ]);

  const GRIDITEM_SCHEMA = makeSchema([
    ["grid_item_type", "enum", GRID_ITEM_TYPE, true, "物品类型"],
    ["grid_item_state", "enum", GRID_ITEM_STATE, true, "状态"],
    ["grid_x", "i32", null, true, "列"],
    ["grid_y", "i32", null, true, "行"],
    ["grid_item_counter", "i32", null, false],
    ["render_order", "i32", null, false],
    ["dead", "bool", null, true, "已消失"],
    ["pos_x", "f32", null, false],
    ["pos_y", "f32", null, false],
    ["goal_x", "f32", null, false],
    ["goal_y", "f32", null, false],
    ["grid_item_reanim_id", "u32", null, false],
    ["grid_item_particle_id", "u32", null, false],
    ["zombie_type", "enum", ZOMBIE_TYPE, true, "僵尸类型"],
    ["seed_type", "enum", SEED_TYPE, true, "植物类型"],
    ["scary_pot_type", "enum", SCARY_POT_TYPE, true, "花瓶类型"],
    ["highlighted", "bool", null, false],
    ["transparent_counter", "i32", null, false],
    ["sun_count", "i32", null, true, "阳光数"],
    ["motion_trail_frames", "trail", null, false],
    ["motion_trail_count", "i32", null, false],
  ]);

  const SEED_PACKET_SCHEMA = makeSchema([
    ["refresh_counter", "i32", null, true, "冷却"],
    ["refresh_time", "i32", null, true, "冷却时间"],
    ["index", "i32", null, false],
    ["offset_x", "i32", null, false],
    ["packet_type", "enum", SEED_TYPE, true, "卡片植物"],
    ["imitater_type", "enum", SEED_TYPE, true, "模仿植物"],
    ["slot_machine_count_down", "i32", null, false],
    ["slot_machining_next_seed", "enum", SEED_TYPE, false],
    ["slot_machining_position", "f32", null, false],
    ["active", "bool", null, true, "可用"],
    ["refreshing", "bool", null, true, "冷却中"],
    ["times_used", "i32", null, false],
  ]);

  const SEEDBANK_SCHEMA = makeSchema([
    ["num_packets", "i32", null, true, "卡槽数量"],
    ["cut_scene_darken", "i32", null, false],
    ["conveyor_belt_counter", "i32", null, false],
  ]);

  const CURSOR_SCHEMA = makeSchema([
    ["seed_bank_index", "i32", null, true, "卡槽索引"],
    ["type", "enum", SEED_TYPE, true, "手持植物"],
    ["imitater_type", "enum", SEED_TYPE, true, "模仿植物"],
    ["cursor_type", "enum", CURSOR_TYPE, true, "光标类型"],
    ["coin_id", "u32", null, false],
    ["glove_plant_id", "u32", null, false],
    ["duplicator_plant_id", "u32", null, false],
    ["cob_cannon_plant_id", "u32", null, false],
    ["hammer_down_counter", "i32", null, false],
    ["reanim_cursor_id", "u32", null, false],
  ]);

  const CURSOR_PREVIEW_SCHEMA = makeSchema([
    ["grid_x", "i32", null, true, "列"],
    ["grid_y", "i32", null, true, "行"],
  ]);

  const CHALLENGE_SCHEMA = makeSchema([
    ["beghouled_mouse_capture", "i32", null, false],
    ["beghouled_mouse_down_x", "i32", null, false],
    ["beghouled_mouse_down_y", "i32", null, false],
    ["beghouled_eated", "i32s", 54, false],
    ["beghouled_purchased_upgrade", "i32s", 3, false],
    ["beghouled_matches_this_move", "i32", null, false],
    ["challenge_state", "enum", CHALLENGE_STATE, true, "挑战状态"],
    ["challenge_state_counter", "i32", null, true, "状态计时"],
    ["conveyor_belt_counter", "i32", null, false],
    ["challenge_score", "i32", null, true, "得分"],
    ["show_bowling_line", "i32", null, false],
    ["last_conveyor_seed_type", "enum", SEED_TYPE, false],
    ["survival_stage", "i32", null, true, "生存关卡"],
    ["slot_machine_roll_count", "i32", null, false],
    ["reanim_challenge", "u32", null, false],
    ["reanim_clouds", "u32s", 6, false],
    ["clouds_counter", "i32s", 6, false],
    ["challenge_grid_x", "i32", null, false],
    ["challenge_grid_y", "i32", null, false],
    ["scary_potter_pots", "i32", null, true, "花瓶数量"],
    ["rain_counter", "i32", null, false],
    ["tree_of_wisdom_talk_index", "i32", null, false],
  ]);

  const MUSIC_SCHEMA = makeSchema([
    ["cur_music_tune", "enum", MUSIC_TUNE, true, "当前音乐"],
    ["cur_music_file_main", "enum", MUSIC_FILE, false],
    ["cur_music_file_drums", "enum", MUSIC_FILE, false],
    ["cur_music_file_hihats", "enum", MUSIC_FILE, false],
    ["burst_override", "i32", null, false],
    ["base_bpm", "f32", null, false],
    ["base_mod_speed", "f32", null, false],
    ["music_burst_state", "enum", MUSIC_BURST_STATE, false],
    ["burst_state_counter", "i32", null, false],
    ["music_drums_state", "enum", MUSIC_DRUMS_STATE, false],
    ["queued_drum_track_packed_order", "i32", null, false],
    ["drums_state_counter", "i32", null, false],
    ["pause_offset", "i32", null, false],
    ["pause_offset_drums", "i32", null, false],
    ["paused", "bool", null, false],
    ["music_disabled", "bool", null, false],
    ["fade_out_counter", "i32", null, false],
    ["fade_out_duration", "i32", null, false],
  ]);

  const SCHEMAS = {
    board: BOARD_SCHEMA,
    zombies: ZOMBIE_SCHEMA,
    plants: PLANT_SCHEMA,
    projectiles: PROJECTILE_SCHEMA,
    coins: COIN_SCHEMA,
    mowers: MOWER_SCHEMA,
    grid_items: GRIDITEM_SCHEMA,
    seed_packets: SEED_PACKET_SCHEMA,
    seed_bank: SEEDBANK_SCHEMA,
    cursor: CURSOR_SCHEMA,
    cursor_preview: CURSOR_PREVIEW_SCHEMA,
    challenge: CHALLENGE_SCHEMA,
    music: MUSIC_SCHEMA,
  };

  const CHUNK_TYPES = {
    1: "BOARD_BASE", 2: "ZOMBIES", 3: "PLANTS", 4: "PROJECTILES", 5: "COINS",
    6: "MOWERS", 7: "GRIDITEMS", 8: "PARTICLE_EMITTERS", 9: "PARTICLE_PARTICLES",
    10: "PARTICLE_SYSTEMS", 11: "REANIMATIONS", 12: "TRAILS", 13: "ATTACHMENTS",
    14: "CURSOR", 15: "CURSOR_PREVIEW", 16: "ADVICE", 17: "SEEDBANK",
    18: "SEEDPACKETS", 19: "CHALLENGE", 20: "MUSIC",
  };
  const CHUNK_IDS = Object.fromEntries(Object.entries(CHUNK_TYPES).map(([id, name]) => [name, Number(id)]));

  const ARRAY_CHUNKS = {
    ZOMBIES: { section: "zombies", schema: ZOMBIE_SCHEMA, hasBase: true, hoistRow: true },
    PLANTS: { section: "plants", schema: PLANT_SCHEMA, hasBase: true, hoistRow: true },
    PROJECTILES: { section: "projectiles", schema: PROJECTILE_SCHEMA, hasBase: true, hoistRow: true },
    COINS: { section: "coins", schema: COIN_SCHEMA, hasBase: true, hoistRow: true },
    MOWERS: { section: "mowers", schema: MOWER_SCHEMA, hasBase: false, hoistRow: false },
    GRIDITEMS: { section: "grid_items", schema: GRIDITEM_SCHEMA, hasBase: false, hoistRow: false },
  };

  const SINGLETON_CHUNKS = {
    SEEDBANK: { section: "seed_bank", schema: SEEDBANK_SCHEMA, hasBase: true },
    CURSOR: { section: "cursor", schema: CURSOR_SCHEMA, hasBase: true },
    CURSOR_PREVIEW: { section: "cursor_preview", schema: CURSOR_PREVIEW_SCHEMA, hasBase: true },
    CHALLENGE: { section: "challenge", schema: CHALLENGE_SCHEMA, hasBase: false },
    MUSIC: { section: "music", schema: MUSIC_SCHEMA, hasBase: false },
  };

  /* ------------------------------------------------------------------ */
  /* Potted plants                                                     */
  /* ------------------------------------------------------------------ */

  function readPottedPlant(raw) {
    const r = new Reader(raw);
    return {
      seedType: r.i32(), garden: r.i32(), x: r.i32(), y: r.i32(), facing: r.i32(),
      padding1: r.i32(), lastWatered: r.i64(), drawVariation: r.i32(), plantAge: r.i32(),
      timesFed: r.i32(), feedingsPerGrow: r.i32(), plantNeed: r.i32(), padding2: r.i32(),
      lastNeedFulfilled: r.i64(), lastFertilized: r.i64(), lastChocolate: r.i64(),
      futureAttribute: r.i64(),
    };
  }

  function writePottedPlant(raw, values) {
    const w = new Writer();
    w.i32(values.seedType | 0);
    w.i32(values.garden | 0);
    w.i32(values.x | 0);
    w.i32(values.y | 0);
    w.i32(values.facing | 0);
    w.i32(values.padding1 | 0);
    w.i64(values.lastWatered || 0);
    w.i32(values.drawVariation | 0);
    w.i32(values.plantAge | 0);
    w.i32(values.timesFed | 0);
    w.i32(values.feedingsPerGrow | 0);
    w.i32(values.plantNeed | 0);
    w.i32(values.padding2 | 0);
    w.i64(values.lastNeedFulfilled || 0);
    w.i64(values.lastFertilized || 0);
    w.i64(values.lastChocolate || 0);
    w.i64(values.futureAttribute || 0);
    const out = w.toBytes();
    if (out.length !== 88) throw new Error("禅境花园植物记录长度错误");
    raw.set(out, 0);
  }

  const POTTED_PLANT_FIELDS = [
    { key: "seedType", label: "植物类型", kind: "enum", table: SEED_TYPE },
    { key: "garden", label: "花园", kind: "enum", table: GARDEN_TYPE },
    { key: "x", label: "X", kind: "i32" },
    { key: "y", label: "Y", kind: "i32" },
    { key: "facing", label: "朝向", kind: "enum", table: FACING_DIRECTION },
    { key: "lastWatered", label: "上次浇水", kind: "i64" },
    { key: "drawVariation", label: "外观变体", kind: "enum", table: DRAW_VARIATION },
    { key: "plantAge", label: "生长阶段", kind: "enum", table: POTTED_PLANT_AGE },
    { key: "timesFed", label: "已喂食次数", kind: "i32" },
    { key: "feedingsPerGrow", label: "升级所需喂食", kind: "i32" },
    { key: "plantNeed", label: "需求", kind: "enum", table: POTTED_PLANT_NEED },
    { key: "lastNeedFulfilled", label: "上次满足需求", kind: "i64" },
    { key: "lastFertilized", label: "上次施肥", kind: "i64" },
    { key: "lastChocolate", label: "上次巧克力", kind: "i64" },
    { key: "futureAttribute", label: "保留字段", kind: "i64" },
  ];

  /* ------------------------------------------------------------------ */
  /* Generic TLV / GameObject helpers                                   */
  /* ------------------------------------------------------------------ */

  function parseTLV(data) {
    const r = new Reader(data);
    const fields = new Map();
    while (r.remaining > 0) {
      if (r.remaining < 8) throw new Error("TLV 字段头不完整");
      const id = r.u32();
      const size = r.u32();
      fields.set(id, r.bytes(size));
    }
    return fields;
  }

  function buildTLV(fields) {
    const w = new Writer();
    const ids = [...fields.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      const data = fields.get(id);
      w.u32(id);
      w.u32(data.length);
      w.raw(data);
    }
    return w.toBytes();
  }

  const GAMEOBJECT_SIZE = 25;

  function readGameObject(raw) {
    if (!raw || raw.length < GAMEOBJECT_SIZE) return null;
    const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    return {
      x: v.getInt32(0, true), y: v.getInt32(4, true), width: v.getInt32(8, true),
      height: v.getInt32(12, true), visible: v.getUint8(16) !== 0,
      row: v.getInt32(17, true), render_order: v.getInt32(21, true),
    };
  }

  const GAMEOBJECT_FIELDS = [
    { key: "x", label: "屏幕 X", kind: "i32", offset: 0 },
    { key: "y", label: "屏幕 Y", kind: "i32", offset: 4 },
    { key: "width", label: "宽度", kind: "i32", offset: 8 },
    { key: "height", label: "高度", kind: "i32", offset: 12 },
    { key: "visible", label: "可见", kind: "bool", offset: 16 },
    { key: "row", label: "行", kind: "i32", offset: 17 },
    { key: "render_order", label: "渲染顺序", kind: "i32", offset: 21 },
  ];

  function writeGameObject(raw, key, value) {
    if (!raw || raw.length < GAMEOBJECT_SIZE) throw new Error("GameObject 数据不完整");
    const spec = GAMEOBJECT_FIELDS.find((f) => f.key === key);
    if (!spec) throw new Error("未知 GameObject 字段");
    const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    if (spec.kind === "bool") v.setUint8(spec.offset, value ? 1 : 0);
    else v.setInt32(spec.offset, Number(value) | 0, true);
  }

  function parseSchemaValues(schema, raw) {
    const values = {};
    let pos = 0;
    for (const spec of schema) {
      if (raw.length - pos < spec.size) break;
      values[spec.key] = readFieldValue(spec, raw, spec.offset);
      pos += spec.size;
    }
    return { values, parsedBytes: pos, extra: raw.slice(pos) };
  }

  function parseItem(data, info) {
    const fields = parseTLV(data);
    const item = { fields, gameobject: null, tail: null, typeName: "" };
    if (fields.has(1)) {
      item.gameobject = { raw: fields.get(1), values: readGameObject(fields.get(1)) };
    }
    if (fields.has(100)) {
      const raw = fields.get(100);
      const parsed = parseSchemaValues(info.schema, raw);
      item.tail = { raw, values: parsed.values, extra: parsed.extra, parsedBytes: parsed.parsedBytes };
    }
    const typeField = info.schema.find((s) => s.key.endsWith("type") || s.key === "seed_type");
    if (typeField && item.tail && item.tail.values[typeField.key] !== undefined) {
      const table = typeField.arg;
      const value = item.tail.values[typeField.key];
      item.typeName = table && table[value] ? table[value] : String(value);
    }
    return item;
  }

  function buildItem(item) {
    return buildTLV(item.fields);
  }

  /* ------------------------------------------------------------------ */
  /* Board chunks                                                       */
  /* ------------------------------------------------------------------ */

  function parseWaves(raw, numWaves) {
    const waves = [];
    if (!raw || raw.length < MAX_WAVES * MAX_ZOMBIES_IN_WAVE * 4) return waves;
    const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const count = Math.max(0, Math.min(MAX_WAVES, Number(numWaves) || 0));
    for (let w = 0; w < count; w++) {
      const list = [];
      for (let i = 0; i < MAX_ZOMBIES_IN_WAVE; i++) {
        const value = v.getInt32((w * MAX_ZOMBIES_IN_WAVE + i) * 4, true);
        if (value === -1) break;
        list.push(value);
      }
      waves.push(list);
    }
    return waves;
  }

  function writeWave(raw, waveIndex, values) {
    const size = MAX_WAVES * MAX_ZOMBIES_IN_WAVE * 4;
    if (!raw || raw.length < size) throw new Error("波次数据不完整");
    const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const base = waveIndex * MAX_ZOMBIES_IN_WAVE * 4;
    const list = values.slice(0, MAX_ZOMBIES_IN_WAVE);
    for (let i = 0; i < list.length; i++) v.setInt32(base + i * 4, Number(list[i]) | 0, true);
    if (list.length < MAX_ZOMBIES_IN_WAVE) v.setInt32(base + list.length * 4, -1, true);
  }

  function readTLVBlob(data) {
    const r = new Reader(data);
    const size = r.u32();
    if (size > r.remaining) throw new Error("TLV blob 数据被截断");
    return r.bytes(size);
  }

  function writeTLVBlob(data) {
    const w = new Writer();
    w.u32(data.length);
    w.raw(data);
    return w.toBytes();
  }

  function parseBoardChunk(inner) {
    const fields = parseTLV(readTLVBlob(inner));
    const board = { kind: "board", fields, dirty: false };
    const numWavesField = fields.get(31);
    board.numWaves = numWavesField && numWavesField.length >= 4 ? readI32(numWavesField, 0) : 0;
    board.wavesRaw = fields.get(18) || null;
    board.waves = parseWaves(board.wavesRaw, board.numWaves);
    return board;
  }

  function getBoardValue(board, spec) {
    const data = board.fields.get(spec.id);
    if (!data || data.length < fieldSize(spec.kind, spec.arg)) return null;
    return readFieldValue(spec, data, 0);
  }

  function setBoardValue(board, spec, value) {
    const data = board.fields.get(spec.id);
    if (!data) throw new Error("存档中不存在该字段，无法修改");
    writeFieldValue(spec, value, data, 0);
    board.dirty = true;
    if (spec.id === 31) {
      board.numWaves = Number(value) | 0;
      board.waves = parseWaves(board.wavesRaw, board.numWaves);
    }
  }

  function setBoardWave(board, index, values) {
    if (!board.wavesRaw) throw new Error("存档中没有波次数据");
    writeWave(board.wavesRaw, index, values);
    board.waves[index] = values.slice(0, MAX_ZOMBIES_IN_WAVE);
    board.dirty = true;
  }

  function buildBoardInner(board) {
    return writeTLVBlob(buildTLV(board.fields));
  }

  /* ------------------------------------------------------------------ */
  /* DataArray chunks                                                   */
  /* ------------------------------------------------------------------ */

  function parseArrayChunk(inner, info, name) {
    const r = new Reader(inner);
    const header = {
      freeListHead: r.u32(), maxUsedCount: r.u32(), size: r.u32(),
      nextKey: r.u32(), maxSize: r.u32(),
    };
    if (header.maxUsedCount > 10000) throw new Error(`${name}: 数组元素数量异常 (${header.maxUsedCount})`);
    const slots = [];
    for (let i = 0; i < header.maxUsedCount; i++) {
      if (r.remaining < 8) throw new Error(`${name}: 数组数据被截断`);
      const id = r.u32();
      const size = r.u32();
      const data = r.bytes(size);
      const slot = { id, raw: data, item: null };
      if ((id & KEY_MASK) !== 0 && data.length > 0) slot.item = parseItem(data, info);
      slots.push(slot);
    }
    return { kind: "array", name, info, header, slots, extra: r.rest(), dirty: false };
  }

  function buildArrayInner(array) {
    const active = array.slots.filter((s) => s.item).length;
    const w = new Writer();
    w.u32(array.header.freeListHead);
    w.u32(array.slots.length);
    w.u32(active);
    w.u32(array.header.nextKey);
    w.u32(array.header.maxSize);
    for (const slot of array.slots) {
      w.u32(slot.id);
      if (slot.item) {
        const data = buildItem(slot.item);
        w.u32(data.length);
        w.raw(data);
      } else if (slot.raw && slot.raw.length) {
        w.u32(slot.raw.length);
        w.raw(slot.raw);
      } else {
        w.u32(0);
      }
    }
    w.raw(array.extra || new Uint8Array(0));
    return w.toBytes();
  }

  function parseIntItemChunk(inner, info) {
    return { kind: "singleton", info, fields: parseTLV(readTLVBlob(inner)), dirty: false };
  }

  function buildSingletonInner(singleton) {
    return writeTLVBlob(buildTLV(singleton.fields));
  }

  function parseSeedPackets(inner) {
    const r = new Reader(inner);
    const count = r.i32();
    if (count < 0 || count > 100) throw new Error("卡槽数量异常");
    const packets = [];
    for (let i = 0; i < count; i++) {
      const size = r.u32();
      const data = r.bytes(size);
      packets.push(parseItem(data, { schema: SEED_PACKET_SCHEMA, hasBase: true }));
    }
    return { kind: "packets", count, packets, extra: r.rest(), dirty: false };
  }

  function buildSeedPackets(packets) {
    const w = new Writer();
    w.i32(packets.packets.length);
    for (const packet of packets.packets) {
      const data = buildItem(packet);
      w.u32(data.length);
      w.raw(data);
    }
    w.raw(packets.extra || new Uint8Array(0));
    return w.toBytes();
  }

  /* ------------------------------------------------------------------ */
  /* .v4 save file                                                      */
  /* ------------------------------------------------------------------ */

  function parseV4(bytes) {
    if (bytes.length < V4_HEADER_SIZE) throw new Error("文件太小，不是有效的 .v4 存档");
    let magic = "";
    for (let i = 0; i < 12; i++) magic += bytes[i] === 0 ? "\0" : String.fromCharCode(bytes[i]);
    if (!magic.startsWith("PVZP_SAVE")) throw new Error("缺少 PVZP_SAVE 标记，不是 PvZ-Portable .v4 存档");
    if (magic !== MAGIC_V4) throw new Error(`不支持的存档格式 ${JSON.stringify(magic)}，仅支持 PVZP_SAVE4`);
    const r = new Reader(bytes);
    r.skip(12);
    const version = r.u32();
    if (version !== V4_VERSION) throw new Error(`不支持的 .v4 版本 ${version}`);
    const payloadSize = r.u32();
    const storedCrc = r.u32();
    if (payloadSize > r.remaining) throw new Error("存档被截断");
    const payload = r.bytes(payloadSize);
    const actualCrc = crc32(payload);
    const model = {
      type: "v4", version, payloadSize, storedCrc, actualCrc,
      crcValid: storedCrc === actualCrc, chunks: [], trailing: new Uint8Array(0), original: bytes.slice(),
    };
    const pr = new Reader(payload);
    while (pr.remaining >= 8) {
      const start = pr.pos;
      const type = pr.u32();
      const size = pr.u32();
      if (size > pr.remaining) throw new Error(`数据块 ${type} 被截断`);
      const data = pr.bytes(size);
      const chunk = { type, name: CHUNK_TYPES[type] || `UNKNOWN_${type}`, data, parsed: null, dirty: false, offset: start };
      try {
        const cr = new Reader(data);
        const cv = cr.u32();
        const layout = cr.u32();
        const innerSize = cr.u32();
        if (cv !== 1 || layout !== 1) throw new Error(`chunk 版本/布局不支持 (${cv}/${layout})`);
        if (innerSize > cr.remaining) throw new Error("chunk inner 数据被截断");
        chunk.inner = cr.bytes(innerSize);
        chunk.chunkVersion = cv;
        chunk.chunkLayout = layout;
        if (chunk.name === "BOARD_BASE") chunk.parsed = parseBoardChunk(chunk.inner);
        else if (ARRAY_CHUNKS[chunk.name]) chunk.parsed = parseArrayChunk(chunk.inner, ARRAY_CHUNKS[chunk.name], chunk.name);
        else if (SINGLETON_CHUNKS[chunk.name]) chunk.parsed = parseIntItemChunk(chunk.inner, SINGLETON_CHUNKS[chunk.name]);
        else if (chunk.name === "SEEDPACKETS") chunk.parsed = parseSeedPackets(chunk.inner);
      } catch (error) {
        chunk.parseError = error.message;
      }
      model.chunks.push(chunk);
    }
    if (pr.remaining > 0) model.trailing = pr.rest();
    return model;
  }

  function buildChunkData(chunk) {
    let inner = null;
    if (chunk.dirty && chunk.parsed) {
      if (chunk.parsed.kind === "board") inner = buildBoardInner(chunk.parsed);
      else if (chunk.parsed.kind === "array") inner = buildArrayInner(chunk.parsed);
      else if (chunk.parsed.kind === "singleton") inner = buildSingletonInner(chunk.parsed);
      else if (chunk.parsed.kind === "packets") inner = buildSeedPackets(chunk.parsed);
    }
    if (!inner) inner = chunk.inner;
    if (!inner) return chunk.data;
    const w = new Writer();
    w.u32(1);
    w.u32(1);
    w.u32(inner.length);
    w.raw(inner);
    return w.toBytes();
  }

  function serializeV4(model) {
    if (!model.chunks.some((c) => c.dirty)) return model.original.slice();
    const payload = new Writer();
    for (const chunk of model.chunks) {
      const data = chunk.dirty ? buildChunkData(chunk) : chunk.data;
      payload.u32(chunk.type);
      payload.u32(data.length);
      payload.raw(data);
    }
    if (model.trailing && model.trailing.length) payload.raw(model.trailing);
    const payloadBytes = payload.toBytes();
    const out = new Writer();
    out.raw(textEncoder.encode("PVZP_SAVE4\0\0"));
    out.u32(V4_VERSION);
    out.u32(payloadBytes.length);
    out.u32(crc32(payloadBytes));
    out.raw(payloadBytes);
    return out.toBytes();
  }

  function getChunk(model, name) {
    return model.chunks.find((c) => c.name === name) || null;
  }

  /* ------------------------------------------------------------------ */
  /* users.dat                                                          */
  /* ------------------------------------------------------------------ */

  function parseUsers(bytes) {
    const r = new Reader(bytes);
    const version = r.u32();
    if (version !== PROFILE_VERSION) throw new Error(`不支持的 users.dat 版本 ${version}（预期 14）`);
    const count = r.u16();
    if (count > 500) throw new Error("用户数量异常");
    const profiles = [];
    for (let i = 0; i < count; i++) {
      const nameInfo = r.string16();
      const useSeq = r.u32();
      const id = r.u32();
      profiles.push({ name: nameInfo.text, nameBytes: nameInfo.raw, useSeq, id });
    }
    return { type: "users", version, profiles, trailing: r.rest(), original: bytes.slice() };
  }

  function serializeUsers(model) {
    const w = new Writer();
    w.u32(PROFILE_VERSION);
    w.u16(model.profiles.length);
    for (const p of model.profiles) {
      const name = p.name;
      const raw = p.nameBytes && decodeText(p.nameBytes) === name ? p.nameBytes : textEncoder.encode(name);
      w.string16(raw);
      w.u32(p.useSeq >>> 0);
      w.u32(p.id >>> 0);
    }
    w.raw(model.trailing || new Uint8Array(0));
    return w.toBytes();
  }

  /* ------------------------------------------------------------------ */
  /* userN.dat                                                          */
  /* ------------------------------------------------------------------ */

  const PROFILE_SCALARS = [
    ["playTimeActive", "u32"], ["playTimeInactive", "u32"],
    ["hasUsedCheatKeys", "u32"], ["hasWokenStinky", "u32"],
    ["didntPurchasePacketUpgrade", "u32"], ["lastStinkyChocolateTime", "u32"],
    ["stinkyPosX", "i32"], ["stinkyPosY", "i32"],
    ["hasUnlockedMinigames", "u32"], ["hasUnlockedPuzzleMode", "u32"],
    ["hasNewMiniGame", "u32"], ["hasNewScaryPotter", "u32"],
    ["hasNewIZombie", "u32"], ["hasNewSurvival", "u32"],
    ["hasUnlockedSurvivalMode", "u32"], ["needsMessageOnGameSelector", "u32"],
    ["needsMagicTacoReward", "u32"], ["hasSeenStinky", "u32"],
    ["hasSeenUpsell", "u32"], ["placeHolderPlayerStats", "u32"],
  ];

  function parseProfile(bytes) {
    const r = new Reader(bytes);
    const version = r.u32();
    if (version !== USER_VERSION) throw new Error(`不支持的用户存档版本 ${version}（预期 12）`);
    const level = r.i32();
    const coins = r.i32();
    const finishedAdventure = r.u32();
    const challengeRecords = [];
    for (let i = 0; i < 100; i++) challengeRecords.push(r.u32());
    const purchases = [];
    for (let i = 0; i < 80; i++) purchases.push(r.u32());
    const model = { type: "profile", version, level, coins, finishedAdventure, challengeRecords, purchases };
    for (const [key] of PROFILE_SCALARS) model[key] = r.u32();
    model.stinkyPosX = model.stinkyPosX | 0;
    model.stinkyPosY = model.stinkyPosY | 0;
    const numPottedPlants = r.u32();
    if (numPottedPlants > MAX_POTTED_PLANTS) throw new Error(`禅境花园植物数量异常 (${numPottedPlants})`);
    const plants = [];
    for (let i = 0; i < numPottedPlants; i++) {
      const raw = r.bytes(88);
      plants.push({ raw, values: readPottedPlant(raw) });
    }
    model.plants = plants;
    const achievements = [];
    for (let i = 0; i < 20 && r.remaining >= 2; i++) achievements.push(r.u16());
    while (achievements.length < 20) achievements.push(0);
    model.achievements = achievements;
    model.hasZombatarSection = r.remaining >= 1;
    model.zombatarAccepted = r.remaining >= 1 ? r.u8() : 0;
    model.zombatarCount = r.remaining >= 4 ? r.u32() : 0;
    if (model.zombatarCount > MAX_ZOMBATAR_HEADS) throw new Error(`僵尸头像数量异常 (${model.zombatarCount})`);
    const zombatarBytes = model.zombatarCount * ZOMBATAR_RECORD_SIZE;
    if (zombatarBytes > r.remaining) throw new Error("僵尸头像数据被截断");
    model.zombatarData = r.bytes(zombatarBytes);
    const miniGameFlags = [];
    for (let i = 0; i < 20 && r.remaining >= 1; i++) miniGameFlags.push(r.u8());
    while (miniGameFlags.length < 20) miniGameFlags.push(0);
    model.miniGameFlags = miniGameFlags;
    model.zombatarCreatedBefore = r.remaining >= 1 ? r.u8() : 0;
    model.trailing = r.rest();
    model.original = bytes.slice();
    return model;
  }

  function serializeProfile(model) {
    const w = new Writer();
    w.u32(USER_VERSION);
    w.i32(model.level | 0);
    w.i32(model.coins | 0);
    w.u32(model.finishedAdventure >>> 0);
    if (model.challengeRecords.length !== 100) throw new Error("挑战记录必须为 100 项");
    for (const v of model.challengeRecords) w.u32(v >>> 0);
    if (model.purchases.length !== 80) throw new Error("商店记录必须为 80 项");
    for (const v of model.purchases) w.u32(v >>> 0);
    for (const [key] of PROFILE_SCALARS) w.u32((model[key] || 0) >>> 0);
    if (model.plants.length > MAX_POTTED_PLANTS) throw new Error("禅境花园植物数量超过 200");
    w.u32(model.plants.length);
    for (const plant of model.plants) {
      const raw = plant.raw.slice();
      writePottedPlant(raw, plant.values);
      w.raw(raw);
    }
    if (model.achievements.length !== 20) throw new Error("成就数量必须为 20");
    for (const v of model.achievements) w.u16(v & 0xffff);
    const zombatarData = model.zombatarData || new Uint8Array(0);
    if (zombatarData.length % ZOMBATAR_RECORD_SIZE !== 0) throw new Error("僵尸头像数据长度错误");
    w.u8(model.zombatarAccepted ? 1 : 0);
    w.u32(zombatarData.length / ZOMBATAR_RECORD_SIZE);
    w.raw(zombatarData);
    const flags = model.miniGameFlags || [];
    for (let i = 0; i < 20; i++) w.u8(flags[i] ? 1 : 0);
    w.u8(model.zombatarCreatedBefore ? 1 : 0);
    w.raw(model.trailing || new Uint8Array(0));
    return w.toBytes();
  }

  /* ------------------------------------------------------------------ */
  /* File detection                                                     */
  /* ------------------------------------------------------------------ */

  function detectFile(name, bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8.length >= 12) {
      let magic = "";
      for (let i = 0; i < 12; i++) magic += u8[i] === 0 ? "\0" : String.fromCharCode(u8[i]);
      if (magic.startsWith("PVZP_SAVE")) return { kind: "v4", model: parseV4(u8), name };
    }
    if (u8.length >= 4) {
      const version = readU32(u8, 0);
      if (version === PROFILE_VERSION) return { kind: "users", model: parseUsers(u8), name };
      if (version === USER_VERSION) return { kind: "profile", model: parseProfile(u8), name };
      if (version === 10 || version === 11) {
        throw new Error(`旧版用户存档（版本 ${version}）暂不支持；请先用游戏保存一次以升级到版本 12。`);
      }
    }
    return { kind: "legacy", model: { type: "legacy", raw: u8, size: u8.length }, name };
  }

  return {
    VERSION: "1.0",
    MAGIC_V4, V4_HEADER_SIZE, USER_VERSION, PROFILE_VERSION,
    MAX_POTTED_PLANTS, ZOMBATAR_RECORD_SIZE, MAX_WAVES, MAX_ZOMBIES_IN_WAVE,
    Reader, Writer, crc32, hex, decodeText, readU32, writeU32, readI32, writeI32, readI64, writeI64,
    parseTLV, buildTLV, readGameObject, writeGameObject, readPottedPlant, writePottedPlant,
    parseProfile, serializeProfile, parseUsers, serializeUsers, parseV4, serializeV4, getChunk, detectFile,
    parseWaves, writeWave, getBoardValue, setBoardValue, setBoardWave,
    parseSchemaValues, readFieldValue, writeFieldValue,
    enums: { SEED_TYPE, ZOMBIE_TYPE, BACKGROUND_TYPE, GRID_SQUARE_TYPE, PLANT_ROW_TYPE, BOARD_RESULT, HELM_TYPE, SHIELD_TYPE, ZOMBIE_HEIGHT, PLANT_STATE, PLANT_SUBCLASS, PLANT_ON_BUNGEE_STATE, COIN_TYPE, COIN_MOTION, GRID_ITEM_TYPE, GRID_ITEM_STATE, SCARY_POT_TYPE, LAWN_MOWER_STATE, LAWN_MOWER_TYPE, MOWER_HEIGHT, CURSOR_TYPE, CHALLENGE_STATE, PROJECTILE_MOTION, PROJECTILE_TYPE, MUSIC_TUNE, MUSIC_FILE, MUSIC_BURST_STATE, MUSIC_DRUMS_STATE, GARDEN_TYPE, POTTED_PLANT_AGE, POTTED_PLANT_NEED, FACING_DIRECTION, DRAW_VARIATION },
    schemas: SCHEMAS, boardSchema: BOARD_SCHEMA, boardById: BOARD_BY_ID, chunkTypes: CHUNK_TYPES, chunkIds: CHUNK_IDS,
    gameObjectFields: GAMEOBJECT_FIELDS, pottedPlantFields: POTTED_PLANT_FIELDS,
    zombiePhase: ZOMBIE_PHASE, tutorialState: TUTORIAL_STATE,
  };
});

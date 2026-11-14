import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

// 获取命令行传入的密码，如果没有则随机生成一个
const pw = process.argv[2] || 'CHANGE_ME_' + Math.random().toString(36).slice(2, 10);

// 生成 bcrypt 哈希（cost = 12，与原 PHP 配置保持一致）
const hash = bcrypt.hashSync(pw, 12);

// 生成 64 位十六进制签名密钥
const key = crypto.randomBytes(32).toString('hex');

// 同时生成 Base64 版本，用于绕过 $ 符号转义问题
const hashB64 = 'B64:' + Buffer.from(hash).toString('base64');

console.log('\n==============================================');
console.log(' 环境变量生成成功，请填入 Hostless 控制台');
console.log('==============================================\n');

console.log('【变量 1】ADMIN_PASSWORD_HASH');
console.log(hash);
console.log('\n 如果平台报错或登录失败（可能是 $ 符号被吞），改用下面这个：');
console.log('【备用】ADMIN_PASSWORD_HASH');
console.log(hashB64);
console.log('\n----------------------------------------------\n');

console.log('【变量 2】ADMIN_SIGNING_KEY');
console.log(key);
console.log('\n----------------------------------------------\n');

console.log(`【你的管理员登录密码】: ${pw}`);
console.log('（请务必牢记此密码，该明文只在此处显示一次）\n');
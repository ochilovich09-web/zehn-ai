const COLOR = { info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', ok: '\x1b[32m', dim: '\x1b[90m', reset: '\x1b[0m' };
const stamp = () => new Date().toISOString().slice(11, 23);

function emit(level, args) {
  const c = COLOR[level] || '';
  const tag = level.toUpperCase().padEnd(5);
  console.log(`${COLOR.dim}${stamp()}${COLOR.reset} ${c}${tag}${COLOR.reset}`, ...args);
}

export const log = {
  info: (...a) => emit('info', a),
  warn: (...a) => emit('warn', a),
  error: (...a) => emit('error', a),
  ok: (...a) => emit('ok', a),
  request(req, status, ms) {
    const color = status >= 500 ? COLOR.error : status >= 400 ? COLOR.warn : COLOR.ok;
    console.log(
      `${COLOR.dim}${stamp()}${COLOR.reset} ${color}${status}${COLOR.reset} ` +
      `${req.method.padEnd(6)} ${req.url.split('?')[0]} ${COLOR.dim}${ms}ms${COLOR.reset}`
    );
  },
};

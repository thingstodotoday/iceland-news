const ts = () => new Date().toISOString();

module.exports = {
  info: (...a) => console.log(ts(), 'INFO ', ...a),
  warn: (...a) => console.warn(ts(), 'WARN ', ...a),
  broken: (source, reason) => console.error(ts(), 'BROKEN', `[${source}]`, reason)
};

/** Shared hostname scope for the worker and classic UI scripts. */
(() => {
  function canonicalHost(host) {
    return String(host).toLowerCase().replace(/\.$/, '');
  }
  function matches(host, domain) {
    host = canonicalHost(host);
    domain = canonicalHost(domain);
    return host === domain || host.endsWith(`.${domain}`);
  }
  function matchesRule(rule, host) {
    return matches(host, rule.domain) && !(rule.excludedSubdomains || []).some(domain => matches(host, domain));
  }
  function overlaps(a, b) {
    return matchesRule(a, b.domain) || matchesRule(b, a.domain);
  }
  function validateExclusions(domain, input, normalize) {
    if (!Array.isArray(input) || input.length > 50) throw new Error('対象外のサブドメインはサイトごとに50件までです');
    const result = input.map(normalize);
    for (let i = 0; i < result.length; i++) {
      if (result[i] === domain || !matches(result[i], domain)) throw new Error(`${result[i]} は ${domain} のサブドメインではありません`);
      if (result.slice(0, i).includes(result[i])) throw new Error(`${result[i]} は対象外の欄で重複しています`);
    }
    return result;
  }
  globalThis.JikanDomains = Object.freeze({matches, matchesRule, overlaps, validateExclusions});
})();

const fetch = require('./fetch')
const { wait } = require('../utils')
const querystring = require('querystring')
const { getSignatureHeaders } = require('./oauth')
const checkKnownIssues = require('./check_known_issues')
const parseResponseBody = require('./parse_response_body')
const timeout = 30000

module.exports = (verb, params) => {
  const method = verb || 'get'
  const { url, oauth: oauthTokens, headers, autoRetry = true } = params
  const { body } = params
  const maxlag = body && body.maxlag
  let attempts = 1

  let bodyStr
  if (method === 'post' && body != null) {
    bodyStr = querystring.stringify(body)
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
  }

  const tryRequest = async () => {
    if (oauthTokens) {
      const signatureHeaders = getSignatureHeaders({
        url,
        method,
        data: body,
        oauthTokens
      })
      Object.assign(headers, signatureHeaders)
    }

    return fetch(url, { method, body: bodyStr, headers, timeout })
    .then(parseResponseBody)
    .catch(err => {
      checkKnownIssues(url, err)
      if (autoRetry === false) throw err
      if (errorsWorthARetry.includes(err.name)) {
        const delaySeconds = getRetryDelay(err.headers) * attempts
        retryWarn(verb, url, err, delaySeconds, attempts++, maxlag)
        return wait(delaySeconds * 1000).then(tryRequest)
      } else {
        throw err
      }
    })
  }

  return tryRequest()
}

const errorsWorthARetry = [
  'maxlag',
  'TimeoutError',
  // failed-save might be an error from the server
  // See https://github.com/maxlath/wikibase-cli/issues/150
  'failed-save',
]

const defaultRetryDelay = 5
const getRetryDelay = headers => {
  const retryAfterSeconds = headers && headers['retry-after']
  if (/^\d+$/.test(retryAfterSeconds)) return parseInt(retryAfterSeconds)
  else return defaultRetryDelay
}

const retryWarn = (verb, url, err, delaySeconds, attempts, maxlag) => {
  verb = verb.toUpperCase()
  console.warn(`[wikibase-edit][WARNING] ${verb} ${url}
    ${err.message}
    retrying in ${delaySeconds}s (attempt: ${attempts}, maxlag: ${maxlag}s)`)
}

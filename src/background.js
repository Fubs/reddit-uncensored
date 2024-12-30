export var MsgType = {
  COMMENTS_AUTHOR: 1,
  COMMENTS_BODY: 2,
  COMMENTS_ALL: 3,
  MAIN_POST: 4,
}

export var ResponseType = {
  COMMENTS_DATA: 'commentsData',
  POST_DATA: 'postData',
}

/**
 * @typedef {Object} PostData
 * @property {string} author
 * @property {string} title
 * @property {string} selftext_html
 * @property {string} selftext
 */

/**
 * @typedef {Object} CommentData
 * @property {string} author
 * @property {string} body
 * @property {string} body_html
 */

/**
 * @typedef {Object} SendResponse
 * @property {string} error
 * @property {CommentData} [commentsData]
 * @property {PostData} [postData]
 /**
 * @param {string} endpointUrl
 * @param {typeof ResponseType} responseType
 * @param {Function[SendResponse]} sendResponse
 */
function fetchData(endpointUrl, responseType, sendResponse) {
  fetch(endpointUrl)
    .then(response => {
      if (!response.ok) {
        return response.json().then(errorData => {
          throw new Error(`Error ${response.status}: ${errorData.message}`)
        })
      }
      return response.json()
    })
    .then(data => {
      if (!data || !data.data) {
        throw new Error('Invalid data format received from API')
      }
      const responseData = {}
      responseData[responseType] = data.data
      if (responseData[responseType]['author']) responseData[responseType]['author'] = responseData[responseType]['author'].replace(/[^\[\]\-\w]/g, '')
      if (responseData[responseType]['title']) responseData[responseType]['title'] = responseData[responseType]['title'].replace(/[^\[\]\-\w]/g, '')

      // body and selftext should be accessed only through the sanitized "body_html" and "selftext_html".
      // which are returned by the API when the &md2html=true query parameter is specified
      if (responseData[responseType]['body']) delete responseData[responseType]['body']
      if (responseData[responseType]['selftext']) delete responseData[responseType]['selftext']

      sendResponse(responseData)
    })
    .catch(error => {
      console.error(`Error fetching ${responseType}:`, error)
      sendResponse({ error: error.message })
    })
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MsgType.COMMENTS_AUTHOR || message.type === MsgType.COMMENTS_BODY || message.type === MsgType.COMMENTS_ALL) {
    const endpoint = 'comments'
    let fields = ''

    if (message.type === MsgType.COMMENTS_AUTHOR) {
      fields = 'author'
    } else if (message.type === MsgType.COMMENTS_BODY) {
      fields = 'body&md2html=true'
    } else if (message.type === MsgType.COMMENTS_ALL) {
      fields = 'author,body&md2html=true'
    }
    const endpointUrl = `https://arctic-shift.photon-reddit.com/api/${endpoint}/ids?ids=${message.commentIds.join(',')}&fields=${fields}`

    fetchData(endpointUrl, ResponseType.COMMENTS_DATA, sendResponse)
    return true
  } else if (message.type === MsgType.MAIN_POST) {
    const endpoint = 'posts'
    const fields = message.fields || 'author,selftext,title'
    const endpointUrl = `https://arctic-shift.photon-reddit.com/api/${endpoint}/ids?ids=${message.postIdStr}&fields=${fields}`

    fetchData(endpointUrl, ResponseType.POST_DATA, sendResponse)
    return true
  } else {
    console.error('Unknown message type:', message.type)
    return false
  }
})

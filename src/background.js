export var MsgTypeEnum = {
  COMMENTS_AUTHOR: 1,
  COMMENTS_BODY: 2,
  COMMENTS_ALL: 3,
  MAIN_POST: 4,
}

/**
 * @param endpointUrl
 * @param dataType
 * @param sendResponse
 */
function fetchData(endpointUrl, dataType, sendResponse) {
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
      responseData[dataType] = data.data
      if (responseData[dataType]['author'])
        responseData[dataType]['author'] = responseData[dataType]['author'].replace(/[^\[\]\-\w]/g, '')
      if (responseData[dataType]['title'])
        responseData[dataType]['title'] = responseData[dataType]['title'].replace(/[^\[\]\-\w]/g, '')

      // body and selftext should be accessed only through the sanitized "body_html" and "selftext_html".
      // which are returned by the API when the &md2html=true query parameter is specified
      if (responseData[dataType]['body']) delete responseData[dataType]['body']
      if (responseData[dataType]['selftext']) delete responseData[dataType]['selftext']

      sendResponse(responseData)
    })
    .catch(error => {
      console.error(`Error fetching ${dataType}:`, error)
      sendResponse({ error: error.message })
    })
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    message.type === MsgTypeEnum.COMMENTS_AUTHOR ||
    message.type === MsgTypeEnum.COMMENTS_BODY ||
    message.type === MsgTypeEnum.COMMENTS_ALL
  ) {
    const endpoint = 'comments'
    let fields = ''

    if (message.type === MsgTypeEnum.COMMENTS_AUTHOR) {
      fields = 'author'
    } else if (message.type === MsgTypeEnum.COMMENTS_BODY) {
      fields = 'body&md2html=true'
    } else if (message.type === MsgTypeEnum.COMMENTS_ALL) {
      fields = 'author,body&md2html=true'
    }
    const endpointUrl = `https://arctic-shift.photon-reddit.com/api/${endpoint}/ids?ids=${message.commentIds.join(
      ',',
    )}&fields=${fields}`

    fetchData(endpointUrl, 'commentsData', sendResponse)
    return true
  } else if (message.type === MsgTypeEnum.MAIN_POST) {
    const endpoint = 'posts'
    const fields = message.fields || 'author,selftext,title'
    const endpointUrl = `https://arctic-shift.photon-reddit.com/api/${endpoint}/ids?ids=${message.postIdStr}&fields=${fields}`

    fetchData(endpointUrl, 'postData', sendResponse)
    return true
  } else {
    console.error('Unknown message type:', message.type)
    return false
  }
})

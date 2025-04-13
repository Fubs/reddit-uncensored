/** Enum for message types sent to the background script */
export enum MsgType {
  /** Sent when requesting just the author of one or more comments */
  COMMENTS_AUTHOR = 1,
  /** Sent when requesting just the body of one or more comments */
  COMMENTS_BODY = 2,
  /** Sent when requesting full comment data (author and body) of one or more comments */
  COMMENTS_ALL = 3,
  /** Sent when requesting the main post data (title, body, and author) */
  MAIN_POST = 4,
}

/** Enum for types of data returned from the background script */
export enum ResponseType {
  /** Response contains comments data */
  COMMENTS_DATA = 'commentsData',
  /** Response contains post data */
  POST_DATA = 'postData',
}

/** Post data structure returned from the API */
export interface PostData {
  author?: string;
  title?: string;
  selftext_html?: string;
  selftext?: string;
}

/** Comment data structure returned from the API */
export interface CommentData {
  author?: string;
  body?: string;
  body_html?: string;
}

/** Response structure for sending back to content scripts */
interface SendResponseData {
  error?: string;
  commentsData?: CommentData[];
  postData?: PostData[];
}

/** Message structure for comment requests */
interface CommentRequestMessage {
  type: MsgType.COMMENTS_AUTHOR | MsgType.COMMENTS_BODY | MsgType.COMMENTS_ALL;
  commentIds: string[];
}

/** Message structure for post requests */
interface PostRequestMessage {
  type: MsgType.MAIN_POST;
  postIdStr: string;
  fields?: string;
}

/** Union type for request messages */
type RequestMessage = CommentRequestMessage | PostRequestMessage;

/** Regex for sanitizing author text */
const AUTHOR_REGEX = /[^\[\]\-\w]/g;

/** Regex for sanitizing title text */
const TITLE_REGEX = /[^\w\s.,;:!?'"()\[\]{}\-–—&@#$%*+=/\\<>^~`|•·°§©®™₹€£¥¢₽₩₪₴₦₱₸₼₺₿¤αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ]/gu;

/**
 * Fetches data from the Arctic Shift API
 * @param endpointUrl - The URL to fetch data from
 * @param responseType - The type of response expected
 * @param sendResponse - Callback function to send the response
 */
function fetchData(endpointUrl: string, responseType: ResponseType, sendResponse: (response: SendResponseData) => void): void {
  fetch(endpointUrl)
    .then(async response => {
      if (!response.ok) {
        let errorData = await response.json();
        throw new Error(`Error ${response.status}: ${errorData.message}`);
      }
      return response.json();
    })
    .then(data => {
      if (!data || !data.data) {
        throw new Error('Invalid data format received from API');
      }

      const responseData: SendResponseData = {};
      responseData[responseType] = data.data;

      if (Array.isArray(responseData[responseType])) {
        responseData[responseType]?.forEach(item => {
          // Sanitize author
          if (item.author) item.author = item.author.replace(AUTHOR_REGEX, '');

          // Sanitize title
          if ('title' in item && item.title != null) {
            item.title = item.title.replace(TITLE_REGEX, '');
          }

          // Remove raw body and selftext fields
          if ('body' in item) {
            delete item.body;
          }
          if ('selftext' in item) {
            delete (item as PostData).selftext;
          }
        });
      }

      sendResponse(responseData);
    })
    .catch(error => {
      console.error(`Error fetching ${responseType}:`, error);
      sendResponse({ error: error.message });
    });
}

// Add listener for messages from content scripts
chrome.runtime.onMessage.addListener(
  (message: RequestMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response: SendResponseData) => void): boolean => {
    if (message.type === MsgType.COMMENTS_AUTHOR || message.type === MsgType.COMMENTS_BODY || message.type === MsgType.COMMENTS_ALL) {
      const endpoint = 'comments';
      let fields = '';

      if (message.type === MsgType.COMMENTS_AUTHOR) {
        fields = 'author';
      } else if (message.type === MsgType.COMMENTS_BODY) {
        fields = 'body&md2html=true';
      } else if (message.type === MsgType.COMMENTS_ALL) {
        fields = 'author,body&md2html=true';
      }

      const endpointUrl = `https://arctic-shift.photon-reddit.com/api/${endpoint}/ids?ids=${message.commentIds.join(',')}&fields=${fields}`;

      fetchData(endpointUrl, ResponseType.COMMENTS_DATA, sendResponse);
      return true; // Indicates we'll call sendResponse asynchronously
    } else if (message.type === MsgType.MAIN_POST) {
      const endpoint = 'posts';
      const fields = message.fields || 'author,selftext,title';
      const endpointUrl = `https://arctic-shift.photon-reddit.com/api/${endpoint}/ids?ids=${message.postIdStr}&fields=${fields}`;

      fetchData(endpointUrl, ResponseType.POST_DATA, sendResponse);
      return true; // Indicates we'll call sendResponse asynchronously
    } else {
      console.error('Unknown message type:', message.type);
      return false;
    }
  },
);

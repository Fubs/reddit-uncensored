import DOMPurify from 'dompurify'
import { MsgTypeEnum } from './background.js'
;(function () {
  'use strict'

  let fetchTimer = null

  const idToCommentNode = new Map()
  const scheduledCommentIds = new Set()
  const processedCommentIds = new Set()

  /**
   * Holds ids of comments that have missing fields and need to be fetched
   * @type {{author: Set<string>, body: Set<string>, all: Set<string>}}
   */
  let missingFieldBuckets = {
    author: new Set(),
    body: new Set(),
    all: new Set(),
  }

  const DELETED_TEXT = new Set([
    '[deleted]',
    '[deleted by user]',
    '[removed]',
    '[ Removed by Reddit ]',
    'Removed by Reddit',
    'Comment removed by moderator',
    'Comment deleted by user',
  ])

  /**
   * @param {string} id
   */
  function removeCommentIdFromBuckets(id) {
    missingFieldBuckets.author.delete(id)
    missingFieldBuckets.body.delete(id)
    missingFieldBuckets.all.delete(id)
  }

  /**
   * Expands a comment node.
   * @param {Element} commentNode
   */
  function expandCommentNode(commentNode) {
    commentNode.removeAttribute('collapsed')
    commentNode.classList.remove('collapsed')
    commentNode.classList.add('expanded-by-arctic-shift-extension')
  }

  /**
   * Checks if a string is a valid reddit id.
   * Reddit assigns a unique id to every post and comment
   * @param {string} redditId
   * @returns {boolean}
   */
  function isValidRedditId(redditId) {
    return /^[a-zA-Z0-9]{1,7}$/.test(redditId)
  }

  /**
   * Applies styles to an element by setting the style attribute
   * @param {HTMLElement} element
   * @param {Object} styles
   */
  function applyStyles(element, styles) {
    Object.assign(element.style, styles)
  }

  /**
   * Finds all comment nodes
   * @returns {NodeListOf<Element>}
   */
  function getCommentNodes() {
    return document.querySelectorAll('shreddit-comment')
  }

  /**
   * Finds any new comments that have not yet been processed
   * @returns {NodeListOf<Element>}
   */
  function getNewCommentNodes() {
    return document.querySelectorAll('shreddit-comment:not([undeleted])')
  }

  /**
   * Finds the post node
   * @returns {Element}
   */
  function getPostNode() {
    return document.querySelector('shreddit-post')
  }

  /**
   * Finds the title node of a post
   * @param {HTMLElement} postNode
   * @returns {HTMLElement}
   */
  function getPostTitleNode(postNode) {
    return postNode.querySelector('h1[slot="title"]')
  }

  /**
   * Finds the author node of a post
   * @param {HTMLElement} postNode
   * @returns {HTMLElement}
   */
  function getPostAuthorNode(postNode) {
    return postNode.querySelector('faceplate-tracker[noun="user_profile"]')
  }

  /**
   * Finds the author node of a comment
   * @param {HTMLElement} commentNode
   * @returns {HTMLElement}
   */
  function getCommentAuthorNode(commentNode) {
    const deletedAuthor = commentNode.querySelector('faceplate-tracker[noun="comment_deleted_author"]')
    if (deletedAuthor) {
      return deletedAuthor
    } else {
      return commentNode.querySelector('div[slot="commentMeta"] > faceplate-tracker[noun="comment_author"]')
    }
  }

  /**
   * Determines which fields of a post are missing
   * @param {HTMLElement} postNode
   * @returns {Set<string>}
   */
  function getMissingPostFields(postNode) {
    const missingFields = new Set()

    if (isPostAuthorDeleted(postNode)) {
      missingFields.add('author')
    }
    if (isPostBodyDeleted(postNode)) {
      missingFields.add('selftext')
    }
    if (isPostTitleDeleted(postNode)) {
      missingFields.add('title')
    }

    return missingFields
  }

  /**
   * Check if the comment body is deleted
   * @param {HTMLElement} commentNode
   * @returns {boolean}
   */
  function isCommentBodyDeleted(commentNode) {
    if (commentNode.hasAttribute('deleted') || commentNode.getAttribute('is-comment-deleted') === 'true') {
      return true
    } else {
      const usertextNode = commentNode.querySelector('div.md > div.inline-block > p')
      if (usertextNode) {
        return DELETED_TEXT.has(usertextNode.textContent)
      }

      return false
    }
  }

  /**
   * Check if the comment author is deleted
   * @param {HTMLElement} commentNode
   * @returns {boolean}
   */
  function isCommentAuthorDeleted(commentNode) {
    return (
      DELETED_TEXT.has(commentNode.getAttribute('author')) || commentNode.getAttribute('is-author-deleted') === 'true'
    )
  }

  /**
   * Check if the post body is deleted
   * @param {HTMLElement} postNode
   * @returns {boolean}
   */
  function isPostBodyDeleted(postNode) {
    return (
      !!postNode.querySelector('div[slot="post-removed-banner"]') ||
      (!postNode.querySelector('div[slot="text-body"]') && !postNode.querySelector('div[slot="post-media-container"]'))
    )
  }

  /**
   * Check if the comment author is deleted and the comment body is not
   * @param {HTMLElement} commentNode
   * @returns {boolean}
   */
  function isOnlyCommentAuthorDeleted(commentNode) {
    return isCommentAuthorDeleted(commentNode) && !isCommentBodyDeleted(commentNode)
  }

  /**
   * Check if the comment body is deleted and the comment author is not
   * @param {HTMLElement} commentNode
   * @returns {boolean}
   */
  function isOnlyCommentBodyDeleted(commentNode) {
    return !isCommentAuthorDeleted(commentNode) && isCommentBodyDeleted(commentNode)
  }

  /**
   * Check if the post author is deleted
   * @param {HTMLElement} postNode
   * @returns {boolean}
   */
  function isPostAuthorDeleted(postNode) {
    const postAuthorNode = getPostAuthorNode(postNode)

    if (DELETED_TEXT.has(postNode.getAttribute('author'))) {
      return true
    } else if (postAuthorNode) {
      return DELETED_TEXT.has(postAuthorNode.textContent)
    }

    return false
  }

  /**
   * Check if the post title is deleted
   * @param {HTMLElement} postNode
   * @returns {boolean}
   */
  function isPostTitleDeleted(postNode) {
    const postTitle = postNode.getAttribute('post-title')
    if (postTitle) {
      return DELETED_TEXT.has(postTitle)
    }
  }

  /**
   * Finds the id of a comment
   * @param {HTMLElement} commentNode
   * @returns {string}
   */
  function getCommentId(commentNode) {
    const thingId = commentNode.getAttribute('thingid').replace('t1_', '')
    if (isValidRedditId(thingId)) {
      return thingId
    }
  }

  /**
   * Finds the id of a post
   * @param {HTMLElement} postNode
   * @returns {string}
   */
  function getPostId(postNode) {
    const postId = postNode.getAttribute('id').replace('t3_', '')
    if (isValidRedditId(postId)) {
      return postId
    } else {
      const matches = window.location.href.match(/\/comments\/([a-zA-Z0-9]{0,7})/)
      if (matches && isValidRedditId(matches[1])) {
        return matches[1]
      }
    }
  }

  /**
   * Replace the author of a post or comment with the given text.
   * @param {HTMLElement} authorNode
   * @param {string} author
   */
  function replaceAuthorNode(authorNode, author) {
    let newAuthorElement

    if (DELETED_TEXT.has(author)) {
      newAuthorElement = document.createElement('a')
      newAuthorElement.href = `https://www.reddit.com/u/${author}/`
      newAuthorElement.textContent = author
    } else {
      newAuthorElement = document.createElement('span')
      newAuthorElement.textContent = author
    }

    applyStyles(newAuthorElement, { color: 'salmon' })
    authorNode.replaceWith(newAuthorElement)
  }

  /**
   * @param {HTMLElement} containerNode
   * @param {string} htmlContent
   * @param {Object} styles
   */
  function replaceContentBody(containerNode, htmlContent, styles = {}) {
    const parser = new DOMParser()
    const correctHtmlStr = htmlContent ? htmlContent : '<div slot="text-body">[deleted]</div>'
    const parsedHtml = parser.parseFromString(correctHtmlStr, 'text/html')

    const newContent = document.createElement('div')
    newContent.innerHTML = parsedHtml.body.innerHTML

    applyStyles(newContent, {
      outline: 'salmon solid',
      display: 'inline-block',
      padding: '.4rem',
      width: 'fit-content',
      ...styles,
    })

    containerNode.replaceWith(newContent)
  }

  /**
   * @param {HTMLElement} postNode
   * @param {string} postAuthorText
   * @param {string} postSelftextHtml
   * @param {string} postTitleText
   */
  function updatePostNode(postNode, postAuthorText, postSelftextHtml, postTitleText) {
    if (postAuthorText) {
      updatePostAuthor(postNode, postAuthorText)
    }
    if (postSelftextHtml) {
      updatePostBody(postNode, postSelftextHtml)
    }
    if (postTitleText) {
      updatePostTitle(postNode, postTitleText)
    }
  }

  /**
   * Finds and replaces the author of a post with the given text.
   * @param {HTMLElement} postNode
   * @param {string} postAuthorText
   */
  function updatePostAuthor(postNode, postAuthorText) {
    const postAuthorNode = getPostAuthorNode(postNode)
    if (isPostAuthorDeleted(postNode) && postAuthorNode) {
      replaceAuthorNode(postAuthorNode, postAuthorText)
    }
  }

  /**
   * Finds and replaces the title of a post with the given text, and apply an outline to indicate it was replaced
   * @param {HTMLElement} postNode
   * @param {string} postTitleText
   */
  function updatePostTitle(postNode, postTitleText) {
    const postTitleNode = getPostTitleNode(postNode)
    if (isPostTitleDeleted(postNode) && postTitleText) {
      const newTitle = document.createElement('h1')
      newTitle.setAttribute('slot', 'title')
      postTitleNode.classList.forEach(className => {
        newTitle.classList.add(className)
      })
      newTitle.textContent = postTitleText

      applyStyles(newTitle, {
        outline: 'salmon solid',
        display: 'inline-block',
        padding: '.3rem .3rem .4rem .5rem',
        width: 'fit-content',
        marginTop: '.3rem',
        marginBottom: '.5rem',
      })

      postTitleNode.replaceWith(newTitle)
    }
  }

  /**
   * Finds and replaces the body of a post with archived text, and apply an outline to indicate it was replaced
   * @param {HTMLElement} postNode
   * @param {string} dirtyPostSelftextHtml
   */
  function updatePostBody(postNode, dirtyPostSelftextHtml) {
    const postSelftextHtml = DOMPurify.sanitize(dirtyPostSelftextHtml, {
      USE_PROFILES: { html: true },
    })
    if (!postSelftextHtml) return

    if (!isPostBodyDeleted(postNode)) return

    let replaceTarget = postNode.querySelector('div[slot="post-removed-banner"]')

    if (!replaceTarget) {
      let newReplaceTarget = document.createElement('div')
      postNode.appendChild(newReplaceTarget)

      replaceTarget = newReplaceTarget
    }

    replaceContentBody(replaceTarget, postSelftextHtml, { marginTop: '.6rem' })
  }

  /**
   * Finds and replaces the author and body of a comment, and apply an outline to indicate it was replaced
   * @param {HTMLElement} commentNode
   * @param {string} id
   * @param {string} author
   * @param {string} usertext
   */
  function updateCommentNode(commentNode, id, author, usertext) {
    if (author) {
      updateCommentAuthor(commentNode, author)
    }
    if (usertext) {
      updateCommentBody(commentNode, usertext)
    }
  }

  /**
   * Finds and replaces the author of a comment with a new link to the profile of the original author
   * @param {HTMLElement} commentNode
   * @param {string} author
   */
  function updateCommentAuthor(commentNode, author) {
    if (!author) return
    const authorNode = getCommentAuthorNode(commentNode)
    if (authorNode) {
      replaceAuthorNode(authorNode, author)
    }
  }

  /**
   * Sanitize and replace the body of a comment with archived text
   * @param {HTMLElement} commentNode
   * @param {string} dirtyUsertext
   */
  function updateCommentBody(commentNode, dirtyUsertext) {
    const usertext = DOMPurify.sanitize(dirtyUsertext, {
      USE_PROFILES: { html: true },
    })
    if (!usertext) return
    const usertextNode = commentNode.querySelector('div.md > div.inline-block > p')
    if (!usertextNode) return

    const usertextContainer = usertextNode.parentElement.parentElement
    if (usertextContainer) {
      replaceContentBody(usertextContainer, usertext)
    }
  }

  /**
   * Handle any comments that were loaded before the mutation observer was initialized
   */
  function processExistingComments() {
    const commentNodes = getCommentNodes()
    commentNodes.forEach(commentNode => {
      processCommentNode(commentNode)
    })

    scheduleFetch()
  }

  /**
   * Debounce a function
   * @param {Function} func
   * @param {number} wait
   */
  function debounce(func, wait) {
    let timeout
    return function (...args) {
      clearTimeout(timeout)
      timeout = setTimeout(() => func.apply(this, args), wait)
    }
  }

  /**
   * Loads a mutation observer to watch for new comments
   */
  function observeNewComments() {
    const debounceProcess = debounce(() => {
      processNewComments()
      scheduleFetch()
    }, 100)

    const observer = new MutationObserver(() => {
      debounceProcess()
    })

    observer.observe(document.body, { childList: true, subtree: true })
  }

  function processNewComments() {
    const commentNodes = getNewCommentNodes()
    commentNodes.forEach(processCommentNode)
  }

  /**
   * Process a single comment node, adding it to one of the missing field buckets if any portion was deleted
   * @param {HTMLElement} commentNode
   */
  function processCommentNode(commentNode) {
    const commentId = getCommentId(commentNode)
    if (!commentId) return

    if (scheduledCommentIds.has(commentId)) return
    if (processedCommentIds.has(commentId)) return

    idToCommentNode.set(commentId, commentNode)

    expandCommentNode(commentNode)

    const isBodyDeleted = isCommentBodyDeleted(commentNode)
    const isAuthorDeleted = isCommentAuthorDeleted(commentNode)

    if (!isBodyDeleted && !isAuthorDeleted) return

    if (isOnlyCommentAuthorDeleted(commentNode)) {
      missingFieldBuckets.author.add(commentId)
    } else if (isOnlyCommentBodyDeleted(commentNode)) {
      missingFieldBuckets.author.add(commentId)
    } else {
      missingFieldBuckets.all.add(commentId)
    }

    commentNode.classList.add('undeleted')
    scheduledCommentIds.add(commentId)
  }

  /**
   * After a delay, dispatch any pending comment fetches
   */
  function scheduleFetch() {
    if (!fetchTimer) {
      fetchTimer = setTimeout(() => {
        fetchPendingComments()
      }, 500)
    }
  }

  /**
   * Dispatch pending comment fetches
   */
  function fetchPendingComments() {
    fetchTimer = null

    const fetchPromises = []
    const removeCommentIds = commentIds => {
      commentIds.forEach(removeCommentIdFromBuckets)
    }

    if (missingFieldBuckets.author.size > 0) {
      const authorIds = Array.from(missingFieldBuckets.author)
      fetchPromises.push(fetchCommentBatch(MsgTypeEnum.COMMENTS_AUTHOR, authorIds))
      removeCommentIds(authorIds)
    }

    if (missingFieldBuckets.body.size > 0) {
      const bodyIds = Array.from(missingFieldBuckets.body)
      fetchPromises.push(fetchCommentBatch(MsgTypeEnum.COMMENTS_BODY, bodyIds))
      removeCommentIds(bodyIds)
    }

    if (missingFieldBuckets.all.size > 0) {
      const allIds = Array.from(missingFieldBuckets.all)
      fetchPromises.push(fetchCommentBatch(MsgTypeEnum.COMMENTS_ALL, allIds))
      removeCommentIds(allIds)
    }

    Promise.all(fetchPromises)
      .then(() => {
        // All fetches completed
      })
      .catch(error => {
        console.error('Error fetching comment batches:', error)
      })
  }

  /**
   * Receives a response from the background script.
   * @param {Response} response
   * @param {String[]} commentIds
   * @param {number} type
   */
  function handleResponse(response, commentIds, type) {
    if (response && response.commentsData) {
      response.commentsData
        .map((k, i) => [k, commentIds[i]])
        .forEach(item => {
          const commentNode = idToCommentNode.get(item[1])
          if (commentNode) {
            switch (type) {
              case MsgTypeEnum.COMMENTS_AUTHOR:
                updateCommentAuthor(commentNode, item[0]['author'])
                break
              case MsgTypeEnum.COMMENTS_BODY:
                updateCommentBody(commentNode, item[0]['body_html'])
                break
              case MsgTypeEnum.COMMENTS_ALL:
                updateCommentNode(commentNode, item[1], item[0]['author'], item[0]['body_html'])
                break
            }
          } else {
            console.error('No commentNode found for commentId:', item[1])
          }
        })
    } else {
      console.error('No commentsData received from background script for authors')
    }

    response.commentsData.forEach(data => {
      const commentId = data.id
      scheduledCommentIds.delete(commentId)
      missingFieldBuckets.author.delete(commentId)
      missingFieldBuckets.body.delete(commentId)
      missingFieldBuckets.all.delete(commentId)
    })
  }

  /**
   * Fetches a batch of comments from the background script.
   * @param {number} msgType
   * @param {string[]} commentIds
   */
  async function fetchCommentBatch(msgType, ...commentIds) {
    const commentIdsArray = Array.from(commentIds)
      .flat()
      .filter(thisId => !processedCommentIds.has(thisId))

    if (commentIdsArray.length > 0) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: msgType,
          commentIds: commentIdsArray,
        })

        handleResponse(response, commentIdsArray, msgType)
      } catch (error) {
        const errorTypes = {
          [MsgTypeEnum.COMMENTS_AUTHOR]: 'authors',
          [MsgTypeEnum.COMMENTS_BODY]: 'bodies',
          [MsgTypeEnum.COMMENTS_ALL]: 'full comment data',
        }
        console.error(`Error fetching comment ${errorTypes[msgType]}:`, error)
      }
    }

    commentIdsArray.forEach(n => {
      processedCommentIds.add(n)
      idToCommentNode.delete(n)
    })
  }

  /**
   * Fetches and replaces any missing elements of the post node.
   * @param {HTMLElement} postNode
   */
  async function fetchPostData(postNode) {
    const postId = getPostId(postNode)
    const missingFields = getMissingPostFields(postNode)

    if (missingFields.size === 0) {
      return
    }

    const fields = Array.from(missingFields).join(',') + (missingFields.has('selftext') ? '&md2html=true' : '')

    try {
      const response = await chrome.runtime.sendMessage({
        type: MsgTypeEnum.MAIN_POST,
        postIdStr: postId,
        fields,
      })

      if (response && response.postData && response.postData[0]) {
        const author = response.postData[0]['author'] ? response.postData[0]['author'] : undefined
        const title = response.postData[0]['title'] ? response.postData[0]['title'] : undefined
        const selftext = response.postData[0]['selftext_html']
          ? response.postData[0]['selftext_html']
          : response.postData[0]['selftext'] === ''
          ? "<div class='md'>[deleted]</div>"
          : undefined

        updatePostNode(postNode, author, selftext, title)
      } else {
        console.error('No response or postData from background script', response)
      }
    } catch (error) {
      console.error('Error fetching post data:', error)
    }
  }

  /**
   * Calls fetchPostData to fetch and replace any missing elements of the post node.
   */
  function processMainPost() {
    const postNode = getPostNode()

    fetchPostData(postNode)
      .then(() => {})
      .catch(e => {
        console.error('error:', e)
      })
  }

  processMainPost()
  processExistingComments()
  observeNewComments()
})()

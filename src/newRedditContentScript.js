import DOMPurify from 'dompurify'
import { MsgTypeEnum } from './background.js'
;(async function () {
  'use strict'

  let fetchTimer = null
  let shouldAutoExpand = null

  /**
   * @type {Map<string, HTMLElement>}
   */
  const idToCommentNode = new Map()

  /**
   * @type {Map<string, HTMLElement>}
   */
  const idToUsertextNode = new Map()

  /**
   * @type {Set<string>}
   */
  const scheduledCommentIds = new Set()

  /**
   * @type {Set<string>}
   */
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
    'Comment removed',
    'Comment deleted',
    'Comment removed by moderator',
    'Comment deleted by user',
    'Comment removed by Reddit',
    'Deleted by user',
    'Removed by moderator',
    'Removed by Reddit',
    'Loading from archive...',
  ])

  /**
   * @param {string} id
   */
  async function removeCommentIdFromBuckets(id) {
    missingFieldBuckets.author.delete(id)
    missingFieldBuckets.body.delete(id)
    missingFieldBuckets.all.delete(id)
  }

  /**
   * Expands a comment node.
   * @param {Element} commentNode
   * @returns {Promise<boolean>}
   */
  async function expandCommentNode(commentNode) {
    if (!shouldAutoExpand && commentNode.hasAttribute('collapsed')) {
      // Don't auto-expand if setting is disabled
      return false
    }

    commentNode.removeAttribute('collapsed')
    commentNode.classList.remove('collapsed')
    return true
  }

  /**
   * Checks if a string is a valid reddit id.
   * Reddit assigns a unique id to every post and comment
   * @param {string} redditId
   * @returns {Promise<boolean>}
   */
  async function isValidRedditId(redditId) {
    return /^[a-zA-Z0-9]{1,7}$/.test(redditId)
  }

  /**
   * Applies styles to an element by setting the style attribute
   * @param {HTMLElement} element
   * @param {Object} styles
   */
  async function applyStyles(element, styles) {
    Object.assign(element.style, styles)
  }

  /**
   * Finds all comment nodes
   * @returns {Promise<NodeListOf<Element>>}
   */
  async function getCommentNodes() {
    return document.querySelectorAll('shreddit-comment')
  }

  /**
   * Finds any new comments that have not yet been processed
   * @returns {Promise<NodeListOf<Element>>}
   */
  async function getNewCommentNodes() {
    return document.querySelectorAll('shreddit-comment:not([undeleted])')
  }

  /**
   * Finds the post node
   * @returns {Promise<Element>}
   */
  async function getPostNode() {
    return document.querySelector('shreddit-post')
  }

  /**
   * Finds the title node of a post
   * @param {HTMLElement} postNode
   * @returns {Promise<HTMLLinkElement>}
   */
  async function getPostTitleNode(postNode) {
    return postNode.querySelector('h1[slot="title"]')
  }

  /**
   * Finds the author node of a post
   * @param {HTMLElement} postNode
   * @returns {Promise<HTMLElement>}
   */
  async function getPostAuthorNode(postNode) {
    return postNode.querySelector('faceplate-tracker[noun="user_profile"]')
  }

  /**
   * Finds the author node of a comment
   * @param {HTMLElement} commentNode
   * @returns {Promise<HTMLElement>}
   */
  async function getCommentAuthorNode(commentNode) {
    const deletedAuthor = commentNode.querySelector('faceplate-tracker[noun="comment_deleted_author"]')
    if (deletedAuthor) {
      return deletedAuthor
    } else {
      return commentNode.querySelector('div[slot="commentMeta"] > faceplate-tracker[noun="comment_author"]')
    }
  }

  /**
   * Finds the usertext node of a comment
   * @param {HTMLElement} commentNode
   * @returns {Promise<HTMLElement>}
   */
  async function getCommentUsertextNode(commentNode) {
    return commentNode.querySelector('div.md > div.inline-block > p')
  }

  /**
   * Determines which fields of a post are missing
   * @param {HTMLElement} postNode
   * @returns {Promise<Set<string>>}
   */
  async function getMissingPostFields(postNode) {
    const missingFields = new Set()

    if (await isPostAuthorDeleted(postNode)) {
      missingFields.add('author')
    }
    if (await isPostBodyDeleted(postNode)) {
      missingFields.add('selftext')
    }
    if (await isPostTitleDeleted(postNode)) {
      missingFields.add('title')
    }

    return missingFields
  }

  /**
   * Check if the comment body is deleted
   * @param {HTMLElement} commentNode
   * @returns {Promise<boolean>}
   */
  async function isCommentBodyDeleted(commentNode) {
    if (commentNode.hasAttribute('deleted') || commentNode.getAttribute('is-comment-deleted') === 'true') {
      return true
    } else {
      const usertextNode = await getCommentUsertextNode(commentNode)
      if (usertextNode) {
        return DELETED_TEXT.has(usertextNode.textContent)
      }

      return false
    }
  }

  /**
   * Check if the comment author is deleted
   * @param {HTMLElement} commentNode
   * @returns {Promise<boolean>}
   */
  async function isCommentAuthorDeleted(commentNode) {
    return (
      DELETED_TEXT.has(commentNode.getAttribute('author')) || commentNode.getAttribute('is-author-deleted') === 'true'
    )
  }

  /**
   * Check if the post body is deleted
   * @param {HTMLElement} postNode
   * @returns {Promise<boolean>}
   */
  async function isPostBodyDeleted(postNode) {
    return (
      !!postNode.querySelector('div[slot="post-removed-banner"]') ||
      (!postNode.querySelector('div[slot="text-body"]') && !postNode.querySelector('div[slot="post-media-container"]'))
    )
  }

  /**
   * Check if the comment author is deleted and the comment body is not
   * @param {HTMLElement} commentNode
   * @returns {Promise<boolean>}
   */
  async function isOnlyCommentAuthorDeleted(commentNode) {
    return (await isCommentAuthorDeleted(commentNode)) && !(await isCommentBodyDeleted(commentNode))
  }

  /**
   * Check if the comment body is deleted and the comment author is not
   * @param {HTMLElement} commentNode
   * @returns {Promise<boolean>}
   */
  async function isOnlyCommentBodyDeleted(commentNode) {
    return !(await isCommentAuthorDeleted(commentNode)) && (await isCommentBodyDeleted(commentNode))
  }

  /**
   * Check if the post author is deleted
   * @param {HTMLElement} postNode
   * @returns {Promise<boolean>}
   */
  async function isPostAuthorDeleted(postNode) {
    const postAuthorNode = await getPostAuthorNode(postNode)

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
   * @returns {Promise<boolean>}
   */
  async function isPostTitleDeleted(postNode) {
    const postTitle = postNode.getAttribute('post-title')
    if (postTitle) {
      return DELETED_TEXT.has(postTitle)
    }
  }

  /**
   * Replace a comment with some text to indicate that it is loading
   * @param {string} commentId
   */
  async function showLoadingIndicator(commentId) {
    if (!idToUsertextNode.has(commentId)) return
    const usertextNode = idToUsertextNode.get(commentId)

    if (usertextNode) {
      const loadingDiv = document.createElement('div')
      loadingDiv.className = 'md loading-indicator'
      const loadingInlineBlock = document.createElement('div')
      loadingInlineBlock.className = 'inline-block'
      loadingDiv.appendChild(loadingInlineBlock)
      const loadingP = document.createElement('p')
      loadingP.textContent = 'Loading from archive...'
      await applyStyles(loadingP, {
        color: '#666',
        fontStyle: 'italic',
      })
      loadingInlineBlock.appendChild(loadingP)
      const container = usertextNode.closest('div.md')
      if (container) {
        container.replaceWith(loadingDiv)
      }
    }
  }

  /**
   * Finds the id of a comment
   * @param {HTMLElement} commentNode
   * @returns {Promise<string>}
   */
  async function getCommentId(commentNode) {
    const thingId = commentNode.getAttribute('thingid').replace('t1_', '')
    if (await isValidRedditId(thingId)) {
      return thingId
    }
  }

  /**
   * Finds the id of a post
   * @param {HTMLElement} postNode
   * @returns {Promise<string>}
   */
  async function getPostId(postNode) {
    const postId = postNode.getAttribute('id').replace('t3_', '')
    if (await isValidRedditId(postId)) {
      return postId
    } else {
      const matches = window.location.href.match(/\/comments\/([a-zA-Z0-9]{0,7})/)
      if (matches && (await isValidRedditId(matches[1]))) {
        return matches[1]
      }
    }
  }

  /**
   * Replace the author of a post or comment with the given text.
   * @param {HTMLElement} authorNode
   * @param {string} author
   */
  async function replaceAuthorNode(authorNode, author) {
    let newAuthorElement

    if (!DELETED_TEXT.has(author)) {
      newAuthorElement = document.createElement('a')
      newAuthorElement.href = `https://www.reddit.com/u/${author}/`
      newAuthorElement.textContent = author
    } else {
      newAuthorElement = document.createElement('span')
      newAuthorElement.textContent = '[not found in archive]'
    }

    await applyStyles(newAuthorElement, { color: 'salmon' })
    authorNode.replaceWith(newAuthorElement)
  }

  /**
   * @param {HTMLElement} containerNode
   * @param {string} htmlContent
   * @param {Object} styles
   */
  async function replaceContentBody(containerNode, htmlContent, styles = {}) {
    const parser = new DOMParser()
    const correctHtmlStr = htmlContent ? htmlContent : '<div slot="text-body">[not found in archive]</div>'
    let parsedHtml = parser.parseFromString(correctHtmlStr, 'text/html')
    if (
      parsedHtml &&
      parsedHtml.body &&
      parsedHtml.body.textContent &&
      DELETED_TEXT.has(parsedHtml.body.textContent.trim())
    ) {
      parsedHtml = parser.parseFromString('<div class="md"><p>[not found in archive]</p></div>', 'text/html')
    }

    const newContent = document.createElement('div')
    while (parsedHtml.body.firstChild) {
      newContent.appendChild(parsedHtml.body.firstChild)
    }

    await applyStyles(newContent, {
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
  async function updatePostNode(postNode, postAuthorText, postSelftextHtml, postTitleText) {
    if (postAuthorText) {
      await updatePostAuthor(postNode, postAuthorText)
    }
    if (postSelftextHtml) {
      await updatePostBody(postNode, postSelftextHtml)
    }
    if (postTitleText) {
      await updatePostTitle(postNode, postTitleText)
    }
  }

  /**
   * Finds and replaces the author of a post with the given text.
   * @param {HTMLElement} postNode
   * @param {string} postAuthorText
   */
  async function updatePostAuthor(postNode, postAuthorText) {
    const postAuthorNode = await getPostAuthorNode(postNode)
    if ((await isPostAuthorDeleted(postNode)) && postAuthorNode) {
      await replaceAuthorNode(postAuthorNode, postAuthorText)
    }
  }

  /**
   * Finds and replaces the title of a post with the given text, and apply an outline to indicate it was replaced
   * @param {HTMLElement} postNode
   * @param {string} postTitleText
   */
  async function updatePostTitle(postNode, postTitleText) {
    const postTitleNode = await getPostTitleNode(postNode)
    if ((await isPostTitleDeleted(postNode)) && postTitleText) {
      const newTitle = document.createElement('h1')
      newTitle.setAttribute('slot', 'title')
      postTitleNode.classList.forEach(className => {
        newTitle.classList.add(className)
      })
      newTitle.textContent = postTitleText

      await applyStyles(newTitle, {
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
  async function updatePostBody(postNode, dirtyPostSelftextHtml) {
    const postSelftextHtml = DOMPurify.sanitize(dirtyPostSelftextHtml, {
      USE_PROFILES: { html: true },
    })
    if (!postSelftextHtml) return

    if (!(await isPostBodyDeleted(postNode))) return

    let replaceTarget = postNode.querySelector('div[slot="post-removed-banner"]')

    if (!replaceTarget) {
      let newReplaceTarget = document.createElement('div')
      postNode.appendChild(newReplaceTarget)

      replaceTarget = newReplaceTarget
    }

    await replaceContentBody(replaceTarget, postSelftextHtml, { marginTop: '.6rem' })
  }

  /**
   * Finds and replaces the author and body of a comment, and apply an outline to indicate it was replaced
   * @param {HTMLElement} commentNode
   * @param {string} id
   * @param {string} author
   * @param {string} usertext
   */
  async function updateCommentNode(commentNode, id, author, usertext) {
    if (author) {
      await updateCommentAuthor(commentNode, author)
    }
    if (usertext) {
      await updateCommentBody(commentNode, usertext)
    }
  }

  /**
   * Finds and replaces the author of a comment with a new link to the profile of the original author
   * @param {HTMLElement} commentNode
   * @param {string} author
   */
  async function updateCommentAuthor(commentNode, author) {
    if (!author) return
    const authorNode = await getCommentAuthorNode(commentNode)
    if (authorNode) {
      await replaceAuthorNode(authorNode, author)
    }
  }

  /**
   * Sanitize and replace the body of a comment with archived text
   * @param {HTMLElement} commentNode
   * @param {string} dirtyUsertext
   */
  async function updateCommentBody(commentNode, dirtyUsertext) {
    const usertext = DOMPurify.sanitize(dirtyUsertext, {
      USE_PROFILES: { html: true },
    })
    if (!usertext) return
    const usertextNode = await getCommentUsertextNode(commentNode)
    if (!usertextNode) return

    const usertextContainer = usertextNode.parentElement.parentElement
    if (usertextContainer) {
      await replaceContentBody(usertextContainer, usertext)
    }
  }

  /**
   * Handle any comments that were loaded before the mutation observer was initialized
   */
  async function processExistingComments() {
    const commentNodes = await getCommentNodes()
    commentNodes.forEach(commentNode => {
      processCommentNode(commentNode)
    })

    await scheduleFetch()
  }

  /**
   * Throttles a function call
   * @param {Function} func
   * @param {number} limit
   * @returns {Function}
   */
  function throttle(func, limit) {
    let lastFunc
    let lastRan
    return function (...args) {
      if (!lastRan) {
        func.apply(this, args)
        lastRan = Date.now()
      } else {
        clearTimeout(lastFunc)
        lastFunc = setTimeout(
          () => {
            if (Date.now() - lastRan >= limit) {
              func.apply(this, args)
              lastRan = Date.now()
            }
          },
          limit - (Date.now() - lastRan),
        )
      }
    }
  }

  /**
   * Loads a mutation observer to watch for new comments
   */
  async function observeNewComments() {
    const throttleProcess = throttle(() => {
      processNewComments()
      scheduleFetch()
    }, 100)

    const observer = new MutationObserver(() => {
      throttleProcess()
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['collapsed'],
    })
  }

  async function processNewComments() {
    const commentNodes = await getNewCommentNodes()
    commentNodes.forEach(processCommentNode)
  }

  /**
   * Process a single comment node, adding it to one of the missing field buckets if any portion was deleted
   * @param {HTMLElement} commentNode
   */
  async function processCommentNode(commentNode) {
    const commentId = await getCommentId(commentNode)
    if (!commentId) return

    if (!idToCommentNode.has(commentId)) {
      idToCommentNode.set(commentId, commentNode)
    }

    if (!idToUsertextNode.has(commentId)) {
      idToUsertextNode.set(commentId, await getCommentUsertextNode(commentNode))
    }

    if (!(await expandCommentNode(commentNode))) {
      // Comment wasn't expanded, don't process it yet
      return
    }

    if (scheduledCommentIds.has(commentId)) return
    if (processedCommentIds.has(commentId)) return

    const isBodyDeleted = await isCommentBodyDeleted(commentNode)
    const isAuthorDeleted = await isCommentAuthorDeleted(commentNode)

    if (!isBodyDeleted && !isAuthorDeleted) return

    // Add loading indicator when scheduling a fetch
    if (isBodyDeleted) {
      await showLoadingIndicator(commentId)
    }

    if (await isOnlyCommentAuthorDeleted(commentNode)) {
      missingFieldBuckets.author.add(commentId)
    } else if (await isOnlyCommentBodyDeleted(commentNode)) {
      missingFieldBuckets.body.add(commentId)
    } else {
      missingFieldBuckets.all.add(commentId)
    }

    commentNode.classList.add('undeleted')
    scheduledCommentIds.add(commentId)
  }

  /**
   * After a delay, dispatch any pending comment fetches
   */
  async function scheduleFetch() {
    if (!fetchTimer) {
      fetchTimer = setTimeout(() => {
        fetchPendingComments()
      }, 500)
    }
  }

  /**
   * Dispatch pending comment fetches
   */
  async function fetchPendingComments() {
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
  async function handleResponse(response, commentIds, type) {
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

        await handleResponse(response, commentIdsArray, msgType)
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
    })
  }

  /**
   * Fetches and replaces any missing elements of the post node.
   * @param {HTMLElement} postNode
   */
  async function fetchPostData(postNode) {
    const postId = await getPostId(postNode)
    const missingFields = await getMissingPostFields(postNode)

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
            ? "<div class='md'>[not found in archive]</div>"
            : undefined

        await updatePostNode(postNode, author, selftext, title)
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
  async function processMainPost() {
    const postNode = await getPostNode()
    await fetchPostData(postNode)
  }

  async function loadSettings() {
    chrome.storage.local.get(['expandCollapsedComments'], result => {
      shouldAutoExpand = result.expandCollapsedComments ?? true
    })
  }

  await loadSettings()
  await processMainPost()
  await processExistingComments()
  await observeNewComments()
})()
  .then(() => {})
  .catch(e => console.error('error in reddit-uncensored content script:', e))

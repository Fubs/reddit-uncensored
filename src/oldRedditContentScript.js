import { MsgTypeEnum } from './background.js'
import DOMPurify from 'dompurify'

;(function () {
  'use strict'

  let fetchTimer = null

  const idToCommentNode = new Map()
  const idToUsertextNode = new Map()
  const scheduledCommentIds = new Set()
  const processedCommentIds = new Set()

  let shouldAutoExpand = true

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

  function removeCommentIdFromBuckets(id) {
    missingFieldBuckets.author.delete(id)
    missingFieldBuckets.body.delete(id)
    missingFieldBuckets.all.delete(id)
  }

  function expandCommentNode(commentNode) {
    if (!shouldAutoExpand && commentNode.classList.contains('collapsed')) {
      // Don't auto-expand if setting is disabled
      return false
    }

    commentNode.classList.remove('collapsed')
    return true
  }

  function isValidRedditId(redditId) {
    return /^[a-zA-Z0-9]{1,7}$/.test(redditId)
  }

  function applyStyles(element, styles) {
    Object.assign(element.style, styles)
  }

  /**
   * Gets all comment nodes on the page
   * @returns {NodeListOf<Element>}
   */
  function getCommentNodes() {
    return document.querySelectorAll('div.comment')
  }

  /**
   * Gets all new comment nodes that haven't been processed yet
   * @returns {NodeListOf<Element>}
   */
  function getNewCommentNodes() {
    return document.querySelectorAll('.comment:not([undeleted])')
  }

  function getCommentUsertextNode(commentNode) {
    return commentNode.querySelector('div.usertext-body > div.md')
  }

  /**
   * Gets the main post node
   * @returns {Element}
   */
  function getPostNode() {
    return document.querySelector('div#siteTable').firstElementChild
  }

  /**
   * Gets the title node of a post
   * @param {HTMLElement} postNode
   * @returns {HTMLElement}
   */
  function getPostTitleNode(postNode) {
    return postNode.querySelector('div.top-matter > p.title > a.title')
  }

  /**
   * Gets the author node from a post or comment
   * @param {HTMLElement} root
   * @returns {ChildNode}
   */
  function getAuthorNode(root) {
    const candidate1 = root.querySelector('p.tagline').firstChild.nextSibling

    if (candidate1 && DELETED_TEXT.has(candidate1.textContent.trim())) {
      return candidate1
    }

    const candidate2 = root.querySelector('p.tagline > span')

    if (candidate2 && DELETED_TEXT.has(candidate2.textContent.trim())) {
      return candidate2
    }

    const candidate3 = root.querySelector('p.tagline > a.author')

    if (candidate3 && DELETED_TEXT.has(candidate3.textContent.trim())) {
      return candidate3
    }

    const candidate4 = root.querySelector('p.tagline > a.author')

    if (candidate4) {
      return candidate4
    }

    return null
  }

  /**
   * Gets the body content node of a post
   * @param {HTMLElement} postNode
   * @returns {HTMLElement}
   */
  function getPostBodyNode(postNode) {
    const bodyNode = postNode.querySelector('div.expando > form > div.md-container')
    return bodyNode ? bodyNode : document.querySelector('div.usertext-body.md-container')
  }

  /**
   * Gets a set of missing fields for a post
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
   * Checks if a comment's body is deleted
   * @param {HTMLElement} commentNode
   * @returns {boolean}
   */
  function isCommentBodyDeleted(commentNode) {
    const usertextNode = commentNode.querySelector('div.md > p')
    if (usertextNode) {
      return DELETED_TEXT.has(usertextNode.textContent.trim())
    }
    return false
  }

  /**
   * Checks if a comment's author is deleted
   * @param {HTMLElement} commentNode
   * @returns {boolean}
   */
  function isCommentAuthorDeleted(commentNode) {
    const a = getAuthorNode(commentNode)
    if (a) {
      const textContent = a.textContent.trim()
      return DELETED_TEXT.has(textContent.trim())
    }
  }

  /**
   * Checks if only the comment's author is deleted
   * @param {HTMLElement} commentNode
   * @returns {boolean}
   */
  function isOnlyCommentAuthorDeleted(commentNode) {
    return isCommentAuthorDeleted(commentNode) && !isCommentBodyDeleted(commentNode)
  }

  /**
   * Checks if only the comment's body is deleted
   * @param {HTMLElement} commentNode
   * @returns {boolean}
   */
  function isOnlyCommentBodyDeleted(commentNode) {
    return !isCommentAuthorDeleted(commentNode) && isCommentBodyDeleted(commentNode)
  }

  /**
   * Checks if a post's author is deleted
   * @param {HTMLElement} postNode
   * @returns {boolean}
   */
  function isPostAuthorDeleted(postNode) {
    const postAuthorNode = getAuthorNode(postNode)
    if (!postAuthorNode) {
      console.log('postAuthorNode is null')
      return false
    }
    console.log('postAuthorNode', postAuthorNode)
    return DELETED_TEXT.has(postAuthorNode.textContent.trim())
  }

  /**
   * Checks if a post's title is deleted
   * @param {HTMLElement} postNode
   * @returns {boolean}
   */
  function isPostTitleDeleted(postNode) {
    const postTitleNode = getPostTitleNode(postNode)
    return (
      !postNode.classList.contains('undeleted') && postTitleNode && DELETED_TEXT.has(postTitleNode.textContent.trim())
    )
  }

  /**
   * Checks if a post's body content is deleted
   * @param {HTMLElement} postNode
   * @returns {boolean}
   */
  function isPostBodyDeleted(postNode) {
    if (postNode.classList.contains('undeleted')) return false
    if (postNode.classList.contains('deleted')) return true

    const bodyNode = getPostBodyNode(postNode)

    if (bodyNode.classList.contains('admin_takedown')) return true

    const usertextNode = postNode.querySelector('div.entry div.usertext-body > div.md > p')

    if (usertextNode) {
      return DELETED_TEXT.has(usertextNode.textContent.trim())
    }

    // check if the url was replaced with .../removed_by_reddit/
    // if url was changed to .../removed_by_reddit/, then body was deleted
    if (postNode.hasAttribute('data-permalink')) {
      return postNode.getAttribute('data-permalink').includes('/removed_by_reddit/')
    } else if (postNode.hasAttribute('data-url')) {
      return postNode.getAttribute('data-url').includes('/removed_by_reddit/')
    } else if (
      RegExp(/comments\/[a-zA-Z0-9]{1,8}\/removed_by_reddit\/[a-zA-Z0-9]{1,8}\//g).test(window.location.href)
    ) {
      return true
    }
    return false
  }

  /**
   * Replace a comment with some text to indicate that a it is loading
   * @param {string} commentId
   */
  function showLoadingIndicator(commentId) {
    if (!idToUsertextNode.has(commentId)) return
    const usertextNode = idToUsertextNode.get(commentId)

    if (usertextNode) {
      const parser = new DOMParser()
      const loadingNodeHTML = `<div class="md loading-indicator"><p>Loading from archive...</p></div>`
      const parsedHtml = parser.parseFromString(loadingNodeHTML, 'text/html')
      applyStyles(parsedHtml.body.childNodes[0], {
        color: 'gray',
        fontStyle: 'italic',
      })
      const container = usertextNode.closest('div.md')
      if (container) {
        container.replaceWith(parsedHtml.body.childNodes[0])
      }
    }
  }

  /**
   * Gets the comment ID from a comment node
   * @param {HTMLElement} commentNode
   * @returns {string|null}
   */

  function getCommentId(commentNode) {
    if (commentNode.hasAttribute('reddit-uncensored-cached-id')) {
      return commentNode.getAttribute('reddit-uncensored-cached-id')
    }

    const dataFullname = commentNode.getAttribute('data-fullname')
    if (dataFullname) {
      const id = dataFullname.replace('t1_', '')
      if (isValidRedditId(id)) {
        commentNode.setAttribute('reddit-uncensored-cached-id', id)
        return id
      }
    }

    const permalink = commentNode.getAttribute('data-permalink')
    if (permalink) {
      const match = permalink.match(/\/comments\/[^/]+\/[^/]+\/([^/]+)/)
      if (match && match[1] && isValidRedditId(match[1])) {
        commentNode.setAttribute('reddit-uncensored-cached-id', match[1])
        return match[1]
      }
    }

    console.warn('Could not find comment ID')
    return null
  }

  /**
   * Gets the post ID from a post node
   * @param {HTMLElement} postNode
   * @returns {string}
   * @throws {Error} If post ID cannot be found
   */
  function getPostId(postNode) {
    if (postNode.hasAttribute('reddit-uncensored-cached-id'))
      return postNode.getAttribute('reddit-uncensored-cached-id')

    if (postNode.hasAttribute('data-fullname')) {
      const postId = postNode.getAttribute('data-fullname').replace('t3_', '')
      if (isValidRedditId(postId)) {
        postNode.setAttribute('reddit-uncensored-cached-id', postId)
        return postId
      }
    }

    const matchTarget = postNode.hasAttribute('data-permalink')
      ? postNode.getAttribute('data-permalink')
      : window.location.href

    const matches = matchTarget.match(/\/comments\/([a-zA-Z0-9]{1,7})\//)
    if (matches && isValidRedditId(matches[1])) {
      postNode.setAttribute('reddit-uncensored-cached-id', matches[1])
      return matches[1]
    } else {
      throw new Error("couldn't get post id")
    }
  }

  /**
   * Replaces an author node with new author information
   * @param {HTMLElement | ChildNode} authorNode
   * @param {string} author
   */
  function replaceAuthorNode(authorNode, author) {
    const newAuthorElement = author === '[deleted]' ? document.createElement('span') : document.createElement('a')
    newAuthorElement.textContent = author === '[deleted]' ? '[not found in archive]' : author
    newAuthorElement.href = author === '[deleted]' ? null : `https://old.reddit.com/u/${author}/`

    applyStyles(newAuthorElement, { color: 'red', fontWeight: 'bold' })
    authorNode.replaceWith(newAuthorElement)
  }

  /**
   * Replaces content body with new content
   * @param {HTMLElement} containerNode
   * @param {string} htmlContent
   * @param {Object} styles
   * @param {string|null} newId
   * @param {string} surroundWithDiv
   */
  function replaceContentBody(containerNode, htmlContent, styles = {}, newId = null, surroundWithDiv = '') {
    if (!containerNode) {
      console.warn('Container node is null or undefined')
      return
    }

    const parser = new DOMParser()
    const correctHtmlStr = htmlContent ? htmlContent : '<div class="md"><p>[not found in archive]</p></div>'
    let parsedHtml = parser.parseFromString(correctHtmlStr, 'text/html')
    if (
      parsedHtml &&
      parsedHtml.body &&
      parsedHtml.body.querySelector('p') &&
      parsedHtml.body.querySelector('p').textContent === '[deleted]'
    ) {
      parsedHtml = parser.parseFromString('<div class="md"><p>[not found in archive]</p></div>', 'text/html')
    }
    if (parsedHtml.body.hasChildNodes()) {
      let newMdContainer = parsedHtml.body.childNodes[0]

      Array.from(parsedHtml.body.childNodes)
        .slice(1)
        .forEach(node => {
          newMdContainer.appendChild(node)
        })

      applyStyles(newMdContainer, {
        ...styles,
      })

      if (surroundWithDiv) {
        const surroundingDiv = document.createElement('div')
        surroundingDiv.classList.add(...surroundWithDiv.split(' '))
        applyStyles(surroundingDiv, {
          display: 'block',
        })
        surroundingDiv.appendChild(newMdContainer)
        if (newId) {
          surroundingDiv.id = newId
        }

        containerNode.replaceWith(surroundingDiv)
      } else {
        if (newId) {
          newMdContainer.id = newId
        }
        containerNode.replaceWith(newMdContainer)
      }
    }
  }

  /**
   * Generates a hash code from a string
   * @param {string} str
   * @returns {number}
   */
  function hashCode(str) {
    let hash = 0
    for (let i = 0, len = str.length; i < len; i++) {
      let chr = str.charCodeAt(i)
      hash = (hash << 5) - hash + chr
      hash |= 0 // Convert to 32bit integer
    }
    return hash
  }

  /**
   * Replaces an expando button with a new functional one
   * @param {HTMLElement} originalButton
   * @param {string} nodeIdToExpand
   */
  function replaceExpandoButton(originalButton, nodeIdToExpand) {
    // the expando button on posts is just a toggle to show/hide the post body, but it will break when the post body is replaced with a new node
    // This function replaces the broken expando button with one that is linked with nodeToExpand

    let newBtnDiv = document.createElement('div')
    newBtnDiv.classList.add('expando-button', 'hide-when-pinned', 'selftext', 'expanded')

    newBtnDiv.onclick = function () {
      if (
        document.getElementById(nodeIdToExpand).style.display === 'none' ||
        document.getElementById(nodeIdToExpand).style.display === ''
      ) {
        document.getElementById(nodeIdToExpand).style.display = 'block'
        newBtnDiv.classList.add('expanded')
        newBtnDiv.classList.remove('collapsed')
      } else {
        document.getElementById(nodeIdToExpand).style.display = 'none'
        newBtnDiv.classList.add('collapsed')
        newBtnDiv.classList.remove('expanded')
      }
    }

    originalButton.replaceWith(newBtnDiv)
  }

  /**
   * Adds a metadata button to a comment
   * @param {HTMLElement} commentNode
   */
  function addMetadataButton(commentNode) {
    if (commentNode.querySelector('.metadata-button')) return

    const commentID = getCommentId(commentNode)
    if (!commentID) return

    const flatListButtons = commentNode.querySelector('ul.flat-list.buttons')
    if (!flatListButtons) return

    const li = document.createElement('li')
    const a = document.createElement('a')
    a.href = `https://arctic-shift.photon-reddit.com/api/comments/ids?ids=${commentID}&md2html=true`
    a.textContent = 'metadata'
    a.className = 'metadata-button'

    li.appendChild(a)
    flatListButtons.appendChild(li)
  }

  /**
   * Updates the author node with new author information
   * @param {HTMLElement} rootNode
   * @param {string} author
   */
  function updateAuthorNode(rootNode, author) {
    const authorNode = getAuthorNode(rootNode)
    if (authorNode) {
      replaceAuthorNode(authorNode, author)
    }
  }

  /**
   * Updates a post node with new content
   * @param {HTMLElement} postNode
   * @param {string|null} postAuthorText
   * @param {string|null} postSelftextHtml
   * @param {string|null} postTitleText
   */
  function updatePostNode(postNode, postAuthorText, postSelftextHtml, postTitleText) {
    if (isPostAuthorDeleted(postNode)) updatePostAuthor(postNode, postAuthorText ? postAuthorText : null)
    if (isPostBodyDeleted(postNode)) updatePostBody(postNode, postSelftextHtml ? postSelftextHtml : null)
    if (isPostTitleDeleted(postNode)) updatePostTitle(postNode, postTitleText ? postTitleText : null)

    postNode.classList.remove('deleted')
    postNode.classList.add('undeleted')
  }

  /**
   * Updates a post's author information
   * @param {HTMLElement} postNode
   * @param {string|null} author
   */
  function updatePostAuthor(postNode, author) {
    if (author) {
      updateAuthorNode(postNode, author)
    } else {
      updateAuthorNode(postNode, '[not found in archive]')
    }
  }

  /**
   * Updates a post's title
   * @param {HTMLElement} postNode
   * @param {string|null} postTitleText
   */
  function updatePostTitle(postNode, postTitleText) {
    const newTitleText = postTitleText ? postTitleText : "<h1 class='title'>[not found in archive]</h1>"
    const postTitleNode = getPostTitleNode(postNode)
    if (isPostTitleDeleted(postNode) && newTitleText) {
      const newTitle = document.createElement('a')
      newTitle.href = postTitleNode.href
      newTitle.textContent = newTitleText

      applyStyles(newTitle, {
        border: '2px solid red',
        display: 'inline-block',
        //margin: ".3rem",
        padding: '.3rem',
        width: 'fit-content',
      })

      postTitleNode.replaceWith(newTitle)
    }
  }

  /**
   * Updates a post's body content
   * @param {HTMLElement} postNode
   * @param {string|null} postSelftextHtml
   */
  function updatePostBody(postNode, postSelftextHtml) {
    let expandoNode = postNode.querySelector('div.entry > div.expando')
    const newId = hashCode(
      postNode.hasAttribute('reddit-uncensored-cached-id')
        ? postNode.getAttribute('reddit-uncensored-cached-id')
        : postNode.id !== 'undefined'
          ? postNode.id
          : Math.random().toString(),
    ).toString()

    let replaceTarget
    if (expandoNode) {
      replaceTarget = expandoNode
    } else {
      let newContainer = document.createElement('div')
      newContainer.id = newId
      postNode.querySelector('div.entry > div.top-matter').after(newContainer)

      replaceTarget = newContainer
    }

    // save other non-deleted parts of the post before replacing expando, if any exist
    let extraPostItems = []
    if (expandoNode && expandoNode.querySelector(':scope > div:not(.usertext-body)')) {
      const items = Array.from(expandoNode.querySelectorAll(':scope > div:not(.usertext-body)'))
      extraPostItems = [...items]
    }

    const brokenExpandoBtn = postNode.querySelector('.expando-button')
    if (brokenExpandoBtn) {
      replaceExpandoButton(brokenExpandoBtn, newId)
    }

    const sanitizedHtml = DOMPurify.sanitize(postSelftextHtml, {
      USE_PROFILES: { html: true },
    })

    replaceContentBody(
      replaceTarget,
      sanitizedHtml,
      {
        padding: '.3rem',
        border: '2px solid red',
      },
      newId,
      'usertext usertext-body',
    )

    const p = document.getElementById(newId)
    extraPostItems.forEach(item => {
      p.insertBefore(item, p.lastChild)
    })
  }

  /**
   * Updates a comment node with new content
   * @param {HTMLElement} commentNode
   * @param {string} id
   * @param {string} author
   * @param {string} usertext
   */
  function updateCommentNode(commentNode, id, author, usertext) {
    commentNode.classList.add('undeleted')
    commentNode.classList.remove('deleted')
    if (author) {
      updateCommentAuthor(commentNode, author)
    }
    if (usertext) {
      updateCommentBody(commentNode, usertext)
    }
    addMetadataButton(commentNode)
    commentNode.classList.add('undeleted')
  }

  /**
   * Updates a comment's author information
   * @param {HTMLElement} commentNode
   * @param {string} author
   */
  function updateCommentAuthor(commentNode, author) {
    if (!author) return
    updateAuthorNode(commentNode, author)
    commentNode.classList.add('undeleted')
  }

  /**
   * Updates a comment's body content
   * @param {HTMLElement} commentNode
   * @param {string} usertext
   */
  function updateCommentBody(commentNode, usertext) {
    if (!usertext) return
    const usertextNode = commentNode.querySelector('.md')
    if (usertextNode && isCommentBodyDeleted(commentNode)) {
      const sanitizedHtml = DOMPurify.sanitize(usertext)

      replaceContentBody(usertextNode, sanitizedHtml, {
        display: 'inline-block',
        padding: '.1rem .2rem .1rem .2rem',
        width: 'fit-content',
        border: '2px solid red',
      })
    }
    commentNode.classList.add('undeleted')
    const takedown_div = commentNode.querySelector('div.admin_takedown')
    if (takedown_div) {
      takedown_div.classList.remove('admin_takedown')
    }

    const grayed_div = commentNode.querySelector('div.grayed')
    if (grayed_div) {
      grayed_div.classList.remove('grayed')
    }
  }

  /**
   * Processes all existing comments on the page
   */
  function processExistingComments() {
    const commentNodes = getCommentNodes()

    commentNodes.forEach(commentNode => {
      processCommentNode(commentNode)
    })

    scheduleFetch()
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
   * Sets up an observer for new comments
   */
  function observeNewComments() {
    const throttleProcess = throttle(() => {
      processNewComments()
      scheduleFetch()
    }, 100)

    const observer = new MutationObserver(() => {
      throttleProcess()
    })

    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  }

  /**
   * Processes newly added comments
   */
  function processNewComments() {
    const commentNodes = getNewCommentNodes()
    commentNodes.forEach(processCommentNode)
  }

  /**
   * Processes a single comment node
   * @param {HTMLElement} commentNode
   */
  function processCommentNode(commentNode) {
    const commentId = getCommentId(commentNode)
    if (!commentId) return

    if (!idToCommentNode.has(commentId)) {
      idToCommentNode.set(commentId, commentNode)
    }

    if (!idToUsertextNode.has(commentId)) {
      idToUsertextNode.set(commentId, getCommentUsertextNode(commentNode))
    }

    if (processedCommentIds.has(commentId)) return

    if (!expandCommentNode(commentNode)) {
      // Comment wasn't expanded, don't process it yet
      return
    }

    if (scheduledCommentIds.has(commentId)) return

    const isBodyDeleted = isCommentBodyDeleted(commentNode)
    const isAuthorDeleted = isCommentAuthorDeleted(commentNode)

    if (!isBodyDeleted && !isAuthorDeleted) return

    // Add loading indicator when scheduling a fetch
    if (isBodyDeleted) {
      showLoadingIndicator(commentId)
    }

    if (isOnlyCommentAuthorDeleted(commentNode)) {
      missingFieldBuckets.author.add(commentId)
    } else if (isOnlyCommentBodyDeleted(commentNode)) {
      missingFieldBuckets.body.add(commentId)
    } else {
      missingFieldBuckets.all.add(commentId)
    }

    commentNode.classList.add('undeleted')
    scheduledCommentIds.add(commentId)
  }

  /**
   * Schedules a fetch operation
   */
  function scheduleFetch() {
    if (!fetchTimer) {
      fetchTimer = setTimeout(() => {
        fetchPendingComments()
      }, 200)
    }
  }

  /**
   * Fetches pending comments
   */
  function fetchPendingComments() {
    if (
      missingFieldBuckets.author.size === 0 &&
      missingFieldBuckets.body.size === 0 &&
      missingFieldBuckets.all.size === 0
    )
      return
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

  /** @typedef {Object} Response
   *  @property {Object[]} commentsData
   */

  /**
   * Handles the response from a comment fetch
   * @param {Response} response
   * @param {string[]} commentIds
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
   * Fetches post data
   * @param {HTMLElement} postNode
   * @returns {Promise<void>}
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
            ? "<div class='md'>[not found in archive]</div>"
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
   * Processes the main post
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
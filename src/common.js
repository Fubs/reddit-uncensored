import { MsgType } from './background'

export class RedditContentProcessor {
  constructor() {
    this.shouldAutoExpand = null

    this.idToCommentNode = new Map()
    this.idToUsertextNode = new Map()
    this.scheduledCommentIds = new Set()
    this.processedCommentIds = new Set()
    this.cachedCommentIds = new Map()
    this.cachedPostId = null
    this.autoExpandedCommentIds = new Set()

    /**
     * Sets of comment IDs that are missing a field and need to be fetched
     * @type {{author: Set<string>, body: Set<string>, all: Set<string>}}
     */
    this.missingFieldBuckets = {
      author: new Set(),
      body: new Set(),
      all: new Set(),
    }

    /**
     * Strings that indicate a comment has been deleted
     * @type {Set<string>}
     */
    this.DELETED_TEXT = new Set([
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
      '[ Removed by Reddit on account of violating the [content policy](/help/contentpolicy). ]',
      'Loading from archive...',
    ])
  }

  /**
   * Remove a comment id from all missing field buckets
   * @param id
   * @returns {Promise<void>}
   */
  async removeCommentIdFromBuckets(id) {
    this.missingFieldBuckets.author.delete(id)
    this.missingFieldBuckets.body.delete(id)
    this.missingFieldBuckets.all.delete(id)
  }

  /**
   * Check if a reddit ID is valid
   * Reddit assigns a unique ID to every post and comment. The ID is a base36 representation of the post or comment ID
   * This could increment to 8 digits in the future if enough posts and comments are made,
   * but at the current rate of growth that will be many years from now
   * @param redditId
   * @returns {Promise<boolean>}
   */
  async isValidRedditId(redditId) {
    return /^[a-zA-Z0-9]{1,7}$/.test(redditId)
  }

  async applyStyles(element, styles) {
    Object.assign(element.style, styles)
  }

  /**
   * Debounce a function
   * @param {Function} func
   * @param {number} wait
   */
  debounce(func, wait) {
    let timeout
    return function (...args) {
      clearTimeout(timeout)
      timeout = setTimeout(() => func.apply(this, args), wait)
    }
  }

  /**
   * @param {Object} response
   * @param {string[]} commentIds
   * @param {MsgType} type
   * @returns {Promise<void>}
   */
  async handleResponse(response, commentIds, type) {
    if (response && response.commentsData) {
      for (const item of response.commentsData.map((k, i) => [k, commentIds[i]])) {
        const commentNode = this.idToCommentNode.get(item[1])
        if (commentNode) {
          switch (type) {
            case MsgType.COMMENTS_AUTHOR:
              await this.updateCommentAuthor(commentNode, item[0]['author'])
              break
            case MsgType.COMMENTS_BODY:
              await this.updateCommentBody(commentNode, item[0]['body_html'])
              break
            case MsgType.COMMENTS_ALL:
              await this.updateCommentNode(commentNode, item[1], item[0]['author'], item[0]['body_html'])
              break
          }
        } else {
          console.error('No commentNode found for commentId:', item[1])
        }
      }
    } else {
      console.error('No commentsData received from background script for authors')
    }

    response.commentsData.forEach(data => {
      const commentId = data.id
      this.scheduledCommentIds.delete(commentId)
      this.missingFieldBuckets.author.delete(commentId)
      this.missingFieldBuckets.body.delete(commentId)
      this.missingFieldBuckets.all.delete(commentId)
    })
  }

  /**
   * Expands a comment node.
   * Return value:
   *     True -> comment was expanded by this function, or was already expanded
   *     False -> comment remains collapsed
   * @param {Element} commentNode
   * @returns {Promise<boolean>}
   */
  async expandCommentNode(commentNode) {
    // Don't auto-expand if setting is disabled, or if the comment was already expanded once by this script.
    // The 'depth' !== '0' check is to fix an edge case when viewing of a single-comment-thread page with a deleted root comment
    if (
      (!this.shouldAutoExpand && (commentNode.hasAttribute('collapsed') || commentNode.classList.contains('collapsed'))) ||
      (this.autoExpandedCommentIds.has(this.getCommentId(commentNode)) && commentNode.getAttribute('depth') !== '0')
    ) {
      return false
    }

    if (commentNode.hasAttribute('collapsed')) {
      // hasAttribute('collapsed') indicates new reddit layout
      commentNode.removeAttribute('collapsed')
      commentNode.classList.remove('collapsed')
    } else if (commentNode.classList.contains('collapsed')) {
      // !hasAttribute('collapsed') && classList.contains('collapsed') indicates old reddit layout
      commentNode.classList.remove('collapsed')
      commentNode.classList.add('noncollapsed')
    }

    if (this.shouldAutoExpand) {
      this.autoExpandedCommentIds.add(this.getCommentId(commentNode))
    }
    return true
  }

  /**
   * Returns a promise that, when resolved, will send a message to the background script to fetch data for a batch of comments
   * @param msgType
   * @param commentIds
   * @returns {Promise<void>}
   */
  async fetchCommentBatch(msgType, ...commentIds) {
    const commentIdsArray = Array.from(commentIds)
      .flat()
      .filter(thisId => !this.processedCommentIds.has(thisId))

    if (commentIdsArray.length > 0) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: msgType,
          commentIds: commentIdsArray,
        })

        await this.handleResponse(response, commentIdsArray, msgType)
      } catch (error) {
        const errorTypes = {
          [MsgType.COMMENTS_AUTHOR]: 'authors',
          [MsgType.COMMENTS_BODY]: 'bodies',
          [MsgType.COMMENTS_ALL]: 'full comment data',
        }
        console.error(`Error fetching comment ${errorTypes[msgType]}:`, error)
      }
    }

    commentIdsArray.forEach(n => {
      this.processedCommentIds.add(n)
      this.idToCommentNode.delete(n)
      this.idToUsertextNode.delete(n)
    })
  }

  async fetchPendingComments() {
    if (this.missingFieldBuckets.author.size === 0 && this.missingFieldBuckets.body.size === 0 && this.missingFieldBuckets.all.size === 0) return

    const fetchPromises = []
    let fetchCount = 0
    const removeCommentIds = commentIds => {
      commentIds.forEach(id => this.removeCommentIdFromBuckets(id))
    }

    if (this.missingFieldBuckets.author.size > 0) {
      const authorIds = Array.from(this.missingFieldBuckets.author)
      fetchPromises.push(this.fetchCommentBatch(MsgType.COMMENTS_AUTHOR, authorIds))
      fetchCount += authorIds.length
      await removeCommentIds(authorIds)
    }

    if (this.missingFieldBuckets.body.size > 0) {
      const bodyIds = Array.from(this.missingFieldBuckets.body)
      fetchPromises.push(this.fetchCommentBatch(MsgType.COMMENTS_BODY, bodyIds))
      fetchCount += bodyIds.length
      await removeCommentIds(bodyIds)
    }

    if (this.missingFieldBuckets.all.size > 0) {
      const allIds = Array.from(this.missingFieldBuckets.all)
      fetchPromises.push(this.fetchCommentBatch(MsgType.COMMENTS_ALL, allIds))
      fetchCount += allIds.length
      await removeCommentIds(allIds)
    }

    Promise.all(fetchPromises)
      .then(() => {
        console.log('Fetched archive data for', fetchCount, 'comments')
      })
      .catch(error => {
        console.error('Error fetching archive data:', error)
      })
  }

  async scheduleFetch() {
    await this.fetchPendingComments()
  }

  async processExistingComments() {
    const commentNodes = await this.getCommentNodes()

    commentNodes.forEach(commentNode => {
      this.processCommentNode(commentNode)
    })

    await this.scheduleFetch()
  }

  /**
   * Reads a comment, determines if it is missing a field, and if so adds it to the appropriate bucket
   * @param {Element} commentNode
   * @returns {Promise<void>}
   */
  async processCommentNode(commentNode) {
    const commentId = await this.getCommentId(commentNode)
    if (!commentId) return

    if (!this.idToCommentNode.has(commentId)) {
      this.idToCommentNode.set(commentId, commentNode)
    }

    if (!this.idToUsertextNode.has(commentId)) {
      this.idToUsertextNode.set(commentId, await this.getCommentUsertextNode(commentNode))
    }

    if (this.processedCommentIds.has(commentId)) return
    if (this.scheduledCommentIds.has(commentId)) return

    if (!(await this.expandCommentNode(commentNode))) {
      // Comment wasn't expanded, don't process it yet
      return
    }

    const isBodyDeleted = await this.isCommentBodyDeleted(commentNode)
    const isAuthorDeleted = await this.isCommentAuthorDeleted(commentNode)

    if (!isBodyDeleted && !isAuthorDeleted) return

    // Add loading indicator and metadata button to comments with missing data
    await this.addMetadataButton(commentNode)
    if (isBodyDeleted) {
      await this.showLoadingIndicator(commentId)
    }

    if (await this.isOnlyCommentAuthorDeleted(commentNode)) {
      this.missingFieldBuckets.author.add(commentId)
    } else if (await this.isOnlyCommentBodyDeleted(commentNode)) {
      this.missingFieldBuckets.body.add(commentId)
    } else {
      this.missingFieldBuckets.all.add(commentId)
    }

    commentNode.setAttribute('undeleted', 'true')
    this.scheduledCommentIds.add(commentId)
  }

  /**
   * Checks for new comments and processes them
   * @returns {Promise<void>}
   */
  async processNewComments() {
    const commentNodes = await this.getNewCommentNodes()
    commentNodes.forEach(commentNode => this.processCommentNode(commentNode))
  }

  /**
   * Start a mutation observer to watch for new comments
   * @returns {Promise<void>}
   */
  async observeNewComments() {
    const debounceProcess = this.debounce(() => {
      this.processNewComments()
      this.scheduleFetch()
    }, 100)

    const observer = new MutationObserver(() => {
      debounceProcess()
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'collapsed'],
    })
  }

  /**
   * @returns {Promise<void>}
   */
  async processMainPost() {
    const postNode = await this.getPostNode()
    await this.fetchPostData(postNode)
  }

  /**
   * @param postNode
   * @returns {Promise<void>}
   */
  async fetchPostData(postNode) {
    const postId = await this.getPostId(postNode)
    const missingFields = await this.getMissingPostFields(postNode)

    if (missingFields.size === 0) {
      return
    }

    const fields = Array.from(missingFields).join(',') + (missingFields.has('selftext') ? '&md2html=true' : '')

    try {
      const response = await chrome.runtime.sendMessage({
        type: MsgType.MAIN_POST,
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

        await this.updatePostNode(postNode, author, selftext, title)
      } else {
        console.error('No response or postData from background script', response)
      }
    } catch (error) {
      console.error('Error fetching post data:', error)
    }
  }

  /**
   * Load settings from browser.storage.local into class variables
   * Must be awaited before calling any methods that read the associated variables
   * @returns {Promise<void>}
   */
  async loadSettings() {
    chrome.storage.local.get(['expandCollapsedComments'], result => {
      this.shouldAutoExpand = result.expandCollapsedComments ?? true
    })
  }

  /**
   * Determines which fields of a post are missing
   * @param {HTMLElement} postNode
   * @returns {Promise<Set<string>>}
   */
  async getMissingPostFields(postNode) {
    const missingFields = new Set()

    if (await this.isPostAuthorDeleted(postNode)) {
      missingFields.add('author')
    }
    if (await this.isPostBodyDeleted(postNode)) {
      missingFields.add('selftext')
    }
    if (await this.isPostTitleDeleted(postNode)) {
      missingFields.add('title')
    }

    return missingFields
  }

  // Abstract methods to be implemented in subclasses:
  /**
   * Replace a comment with some text to indicate that it is loading
   * @param {string} commentId
   * @returns {Promise<void>}
   */
  async showLoadingIndicator(commentId) {
    throw new Error('showLoadingIndicator() must be implemented by subclass')
  }

  /**
   * Finds all comment nodes
   * @returns {Promise<NodeListOf<Element>>}
   */
  async getCommentNodes() {
    throw new Error('getCommentNodes() must be implemented by subclass')
  }

  /**
   * Finds any new comments that have not yet been processed
   * @returns {Promise<NodeListOf<Element>>}
   */
  async getNewCommentNodes() {
    throw new Error('getNewCommentNodes() must be implemented by subclass')
  }

  /**
   * Finds the id of a comment
   * @param {HTMLElement} commentNode
   * @returns {Promise<string>}
   */
  async getCommentId(commentNode) {
    throw new Error('getCommentId() must be implemented by subclass')
  }

  /**
   * Finds the usertext node of a comment
   * @param {HTMLElement} commentNode
   * @returns {Promise<HTMLElement>}
   */
  async getCommentUsertextNode(commentNode) {
    throw new Error('getCommentUsertextNode() must be implemented by subclass')
  }

  /**
   * Finds the author node of a comment
   * @param {HTMLElement} commentNode
   * @returns {Promise<HTMLElement>}
   */
  async getCommentAuthorNode(commentNode) {
    throw new Error('getCommentAuthorNode() must be implemented by subclass')
  }

  /**
   * Check if the comment body is deleted
   * @param {HTMLElement} commentNode
   * @returns {Promise<boolean>}
   */
  async isCommentBodyDeleted(commentNode) {
    throw new Error('isCommentBodyDeleted() must be implemented by subclass')
  }

  /**
   * Check if the comment author is deleted
   * @param {HTMLElement} commentNode
   * @returns {Promise<boolean>}
   */
  async isCommentAuthorDeleted(commentNode) {
    throw new Error('isCommentAuthorDeleted() must be implemented by subclass')
  }

  /**
   * Check if the comment author is deleted and the comment body is not
   * @param {HTMLElement} commentNode
   * @returns {Promise<boolean>}
   */
  async isOnlyCommentAuthorDeleted(commentNode) {
    throw new Error('isOnlyCommentAuthorDeleted() must be implemented by subclass')
  }

  /**
   * Check if the comment body is deleted and the comment author is not
   * @param {HTMLElement} commentNode
   * @returns {Promise<boolean>}
   */
  async isOnlyCommentBodyDeleted(commentNode) {
    throw new Error('isOnlyCommentBodyDeleted() must be implemented by subclass')
  }

  /**
   * Finds and replaces the author and body of a comment, and apply an outline to indicate it was replaced
   * @param {HTMLElement} commentNode
   * @param {string} id
   * @param {string} author
   * @param {string} usertext
   * @returns {Promise<void>}
   */
  async updateCommentNode(commentNode, id, author, usertext) {
    throw new Error('updateCommentNode() must be implemented by subclass')
  }

  /**
   * Finds and replaces the author of a comment with a new link to the profile of the original author
   * @param {HTMLElement} commentNode
   * @param {string} author
   * @returns {Promise<void>}
   */
  async updateCommentAuthor(commentNode, author) {
    throw new Error('updateCommentAuthor() must be implemented by subclass')
  }

  /**
   * Sanitize and replace the body of a comment with archived text
   * @param {HTMLElement} commentNode
   * @param {string} dirtyUsertext
   * @returns {Promise<void>}
   */
  async updateCommentBody(commentNode, dirtyUsertext) {
    throw new Error('updateCommentBody() must be implemented by subclass')
  }

  /**
   * Finds the post node
   * @returns {Promise<Element>}
   */
  async getPostNode() {
    throw new Error('getPostNode() must be implemented by subclass')
  }

  /**
   * Finds the id of a post
   * @param {HTMLElement} postNode
   * @returns {Promise<string>}
   */
  async getPostId(postNode) {
    throw new Error('getPostId() must be implemented by subclass')
  }

  /**
   * Gets the title node of a post
   * @param {HTMLElement} postNode
   * @returns {Promise<HTMLLinkElement>}
   */
  async getPostTitleNode(postNode) {
    throw new Error('getPostTitleNode() must be implemented by subclass')
  }

  /**
   * Gets the body content node of a post
   * @param {HTMLElement} postNode
   * @returns {Promise<HTMLElement>}
   */
  async getPostBodyNode(postNode) {
    throw new Error('getPostBodyNode() must be implemented by subclass')
  }

  /**
   * Check if the post author is deleted
   * @param {HTMLElement} postNode
   * @returns {Promise<boolean>}
   */
  async isPostAuthorDeleted(postNode) {
    throw new Error('isPostAuthorDeleted() must be implemented by subclass')
  }

  /**
   * Check if the post body is deleted
   * @param {HTMLElement} postNode
   * @returns {Promise<boolean>}
   */
  async isPostBodyDeleted(postNode) {
    throw new Error('isPostBodyDeleted() must be implemented by subclass')
  }

  /**
   * Check if the post title is deleted
   * @param {HTMLElement} postNode
   * @returns {Promise<boolean>}
   * @returns {Promise<boolean>}
   */
  async isPostTitleDeleted(postNode) {
    throw new Error('isPostTitleDeleted() must be implemented by subclass')
  }

  /**
   * @param {HTMLElement} postNode
   * @param {string} author
   * @param {string} selftext
   * @param {string} title
   * @returns {Promise<void>}
   */
  async updatePostNode(postNode, author, selftext, title) {
    throw new Error('updatePostNode() must be implemented by subclass')
  }

  /**
   * Finds and replaces the author of a post with the given text.
   * @param {HTMLElement} postNode
   * @param {string} postAuthorText
   * @returns {Promise<void>}
   */
  async updatePostAuthor(postNode, postAuthorText) {
    throw new Error('updatePostAuthor() must be implemented by subclass')
  }

  /**
   * Finds and replaces the body of a post with archived text, and apply an outline to indicate it was replaced
   * @param {HTMLElement} postNode
   * @param {string} dirtySelftextHtml
   * @returns {Promise<void>}
   */
  async updatePostBody(postNode, dirtySelftextHtml) {
    throw new Error('updatePostBody() must be implemented by subclass')
  }

  /**
   * Finds and replaces the title of a post with the given text, and apply an outline to indicate it was replaced
   * @param {HTMLElement} postNode
   * @param {string} postTitleText
   * @returns {Promise<void>}
   */
  async updatePostTitle(postNode, postTitleText) {
    throw new Error('updatePostTitle() must be implemented by subclass')
  }

  /**
   * Replace the author of a post or comment with the given text.
   * @param {HTMLElement} authorNode
   * @param {string} author
   * @returns {Promise<void>}
   */
  async replaceAuthorNode(authorNode, author) {
    throw new Error('replaceAuthorNode() must be implemented by subclass')
  }

  /**
   * @param {HTMLElement} containerNode
   * @param {string} htmlContent
   * @param {Object} styles
   * @param {string|null} newId
   * @param {string|null} newClassList
   * @param {string|null} surroundWithDiv
   * @returns {Promise<void>}
   */
  async replaceContentBody(containerNode, htmlContent, styles = {}, newId = null, newClassList = null, surroundWithDiv = null) {
    throw new Error('replaceContentBody() must be implemented by subclass')
  }

  /**
   * Replaces an expando button with a new functional one
   * @param {HTMLElement} originalButton
   * @param {string} nodeIdToExpand
   * @returns {Promise<void>}
   */
  async replaceExpandoButton(originalButton, nodeIdToExpand) {
    throw new Error('replaceExpandoButton() must be implemented by subclass')
  }

  /**
   * Gets the author node from a post or comment
   * @param {HTMLElement} root
   * @returns {Promise<ChildNode>}
   */
  async getAuthorNode(root) {
    throw new Error('getAuthorNode() must be implemented by subclass')
  }

  /**
   * Adds a metadata button to a comment
   * @param {HTMLElement} commentNode
   * @returns {Promise<void>}
   */
  async addMetadataButton(commentNode) {
    throw new Error('addMetadataButton() must be implemented by subclass')
  }
}

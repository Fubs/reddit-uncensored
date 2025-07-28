import { MsgType } from './background';

export class RedditContentProcessor {
  /**
   * Whether to automatically expand collapsed comments. This will be set by settings value in browser.storage.local
   * @protected
   */
  protected shouldAutoExpand: boolean | null = null;

  /**
   * Mapping of comment IDs to their corresponding comment nodes
   * @protected
   */
  protected idToCommentNode: Map<string, HTMLElement> = new Map();

  /**
   * Maps the main post's id to the post usertext node
   * @protected
   */
  protected idToUsertextNode: Map<string, HTMLElement> = new Map();

  /**
   * Set of comment IDs scheduled to have missing data fetched
   * @protected
   */
  protected scheduledCommentIds: Set<string> = new Set();

  /**
   * Set of successfully processed comment ids
   * @protected
   */
  protected processedCommentIds: Set<string> = new Set();

  /**
   * Mapping of a comment node to its id
   * @protected
   */
  protected cachedCommentIds: Map<Element, string> = new Map();

  /**
   * Set of comment IDs that have been automatically expanded by this script
   * @protected
   */
  protected autoExpandedCommentIds: Set<string> = new Set();

  /**
   * Set of comment IDs that were expanded by this extension, or observed to already be expanded
   * @protected
   */
  protected alreadyExpandedOnce: Set<string> = new Set();

  /**
   * Regular expressions for URL pattern matching
   * @protected
   */
  protected singleThreadUrlPattern: RegExp = /^https?:\/\/(old\.|www\.)?reddit\.com\/r\/\w+\/comments\/\w+\/\w+\/\w+\/$/;

  /**
   * Regular expressions for URL pattern matching
   * @protected
   */
  protected subredditUrlPattern: RegExp = /^https?:\/\/(old\.|www\.)?reddit\.com\/r\/(?!.*\/comments\/).*$/;

  /**
   * Regular expressions for URL pattern matching
   * @protected
   */
  protected commentsPageUrlPattern: RegExp = /^https?:\/\/(old\.|www\.)?reddit\.com\/r\/.*\/comments\/.*$/;

  /**
   * Set of processed URLs
   * @protected
   */
  protected processedUrls: Set<string> = new Set();

  /**
   * Map of pending requests
   * @protected
   */
  protected pendingRequests: Map<
    string,
    {
      data: any;
      type: MsgType;
    }
  > = new Map();

  /**
   *  Sets of comment IDs that are missing a field and need to be fetched
   *  @protected
   */
  protected missingFieldBuckets: {
    author: Set<string>;
    body: Set<string>;
    all: Set<string>;
  } = {
    author: new Set(),
    body: new Set(),
    all: new Set(),
  };

  /**
   *  Strings that indicate a comment has been deleted
   *  @protected
   */
  protected DELETED_TEXT: Set<string> = new Set([
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
  ]);

  /**
   *  Flag to track if a mutation was caused by user action
   *  @protected
   */
  protected isUserAction?: boolean;

  /**
   * Cached post ID
   * @protected
   */
  protected cachedPostId?: string | null;

  /**
   * Remove a comment id from all missing field buckets
   * @param id - Comment ID to remove
   */
  async removeCommentIdFromBuckets(id: string): Promise<void> {
    this.missingFieldBuckets.author.delete(id);
    this.missingFieldBuckets.body.delete(id);
    this.missingFieldBuckets.all.delete(id);
  }

  /**
   * Check if a reddit ID is valid
   * Reddit assigns a unique ID to every post and comment. The ID is a base36 representation of the post or comment ID
   * This could increment to 8 digits in the future if enough posts and comments are made,
   * but at the current rate of growth that will be many years from now
   * @param redditId - The Reddit ID to validate
   */
  async isValidRedditId(redditId: string): Promise<boolean> {
    return /^[a-zA-Z0-9]{1,7}$/.test(redditId);
  }

  /**
   * Apply CSS styles to an element
   * @param element - The element to apply styles to
   * @param styles - Object containing CSS properties and values
   */
  async applyStyles(element: HTMLElement, styles: Partial<CSSStyleDeclaration>): Promise<void> {
    Object.assign(element.style, styles);
  }

  /**
   * Debounce a function
   * @param func - The function to debounce
   * @param wait - The debounce delay in milliseconds
   */
  debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: T extends (...args: infer P) => any ? P : never[]) => void {
    let timeout: number | undefined;
    return function (this: any, ...args: T extends (...args: infer P) => any ? P : never[]): void {
      clearTimeout(timeout);
      timeout = window.setTimeout(() => func.apply(this, args), wait);
    };
  }

  /**
   * Handle response from background script
   * @param response - The response data
   * @param commentIds - Array of comment IDs
   * @param type - The message type
   */
  async handleResponse(response: { commentsData?: any[] } | undefined, commentIds: string[], type: MsgType): Promise<void> {
    if (!response || !response.commentsData) {
      console.error('No commentsData received from background script');
      return;
    }

    // Store the response data for any comments not currently in the DOM
    // so we can apply it if they reappear after navigation
    for (let i = 0; i < response.commentsData.length; i++) {
      const data = response.commentsData[i];
      const commentId = commentIds[i];

      const commentNode = this.idToCommentNode.get(commentId);
      if (commentNode) {
        // Node exists, update it immediately
        switch (type) {
          case MsgType.COMMENTS_AUTHOR:
            await this.updateCommentAuthor(commentNode, data.author);
            break;
          case MsgType.COMMENTS_BODY:
            await this.updateCommentBody(commentNode, data.body_html);
            break;
          case MsgType.COMMENTS_ALL:
            await this.updateCommentNode(commentNode, commentId, data.author, data.body_html);
            break;
        }
        // Mark as processed
        this.scheduledCommentIds.delete(commentId);
        this.processedCommentIds.add(commentId);
        await this.removeCommentIdFromBuckets(commentId);
      } else {
        // Node doesn't exist (perhaps due to navigation)
        // Store the data to apply later
        this.pendingRequests.set(commentId, { data, type });
      }
    }
  }

  /** Process any pending requests for comments that now exist in the DOM */
  async processPendingRequests(): Promise<void> {
    if (this.pendingRequests.size === 0) return;

    for (const [commentId, request] of this.pendingRequests.entries()) {
      const commentNode = this.idToCommentNode.get(commentId);

      if (commentNode) {
        // Node is now available, update it
        switch (request.type) {
          case MsgType.COMMENTS_AUTHOR:
            await this.updateCommentAuthor(commentNode, request.data.author);
            break;
          case MsgType.COMMENTS_BODY:
            await this.updateCommentBody(commentNode, request.data.body_html);
            break;
          case MsgType.COMMENTS_ALL:
            await this.updateCommentNode(commentNode, commentId, request.data.author, request.data.body_html);
            break;
        }

        // Remove from pending requests
        this.pendingRequests.delete(commentId);
        // Mark as processed
        this.scheduledCommentIds.delete(commentId);
        this.processedCommentIds.add(commentId);
        await this.removeCommentIdFromBuckets(commentId);
      }
    }
  }

  /**
   * Expands a comment node.
   * Return value:
   *     True -> comment was expanded by this function, or was already expanded
   *     False -> comment remains collapsed
   * @param commentNode - The comment node to expand
   */
  async expandCommentNode(commentNode: HTMLElement): Promise<boolean> {
    const commentId = await this.getCommentId(commentNode);
    if (!commentId) return false;

    // Don't expand if the user manually collapsed this comment, unless its the first comment on a single-comment-thread page
    const isSingleThreadPage = await this.isSingleThreadPage();
    const firstCommentNode = await this.getFirstCommentNode();

    if (this.alreadyExpandedOnce.has(commentId)) {
      // on single-thread pages, always expand the root comment node
      if (!isSingleThreadPage) {
        return false;
      } else if (firstCommentNode !== commentNode) {
        return false;
      }
    }

    // Don't auto-expand if setting is disabled, or if the comment was already expanded once by this script.
    // The 'depth' !== '0' check is to fix an edge case when viewing of a single-comment-thread page with a deleted root comment
    if (
      (!this.shouldAutoExpand && (commentNode.hasAttribute('collapsed') || commentNode.classList.contains('collapsed'))) ||
      (this.autoExpandedCommentIds.has(commentId) && commentNode.getAttribute('depth') !== '0')
    ) {
      // on single-thread pages, always expand the root comment node
      if (isSingleThreadPage && commentNode !== firstCommentNode) {
        return false;
      }
    }

    // For new Reddit (shreddit-comment with shadow DOM)
    if (commentNode.tagName && commentNode.tagName.toLowerCase() === 'shreddit-comment' && (commentNode as HTMLElement).shadowRoot) {
      const details = (commentNode as HTMLElement).shadowRoot?.querySelector('details');
      if (details) {
        if (!details.open) {
          details.open = true;
        }
      }
    }
    // For old Reddit or other implementations
    else if (commentNode.hasAttribute('collapsed')) {
      // hasAttribute('collapsed') indicates new reddit layout without shadow DOM
      commentNode.removeAttribute('collapsed');
      commentNode.classList.remove('collapsed');
    } else if (commentNode.classList.contains('collapsed')) {
      // !hasAttribute('collapsed') && classList.contains('collapsed') indicates old reddit layout
      commentNode.classList.remove('collapsed');
      commentNode.classList.add('noncollapsed');
    }
    this.alreadyExpandedOnce.add(commentId);

    if (this.shouldAutoExpand) {
      this.autoExpandedCommentIds.add(commentId);
    }
    return true;
  }

  /**
   * Returns a promise that, when resolved, will send a message to the background script to fetch data for a batch of comments
   * @param msgType - The type of message to send
   * @param commentIds - Array of comment IDs to fetch
   */
  async fetchCommentBatch(msgType: MsgType, ...commentIds: (string | string[])[]): Promise<void> {
    const commentIdsArray = Array.from(commentIds)
      .flat()
      .filter(thisId => !this.processedCommentIds.has(thisId));

    if (commentIdsArray.length > 0) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: msgType,
          commentIds: commentIdsArray,
        });

        await this.handleResponse(response, commentIdsArray, msgType);
      } catch (error) {
        const errorTypes: Record<MsgType, string> = {
          [MsgType.COMMENTS_AUTHOR]: 'authors',
          [MsgType.COMMENTS_BODY]: 'bodies',
          [MsgType.COMMENTS_ALL]: 'full comment data',
          [MsgType.MAIN_POST]: 'post data',
        };
        console.error(`Error fetching comment ${errorTypes[msgType]}:`, error);
      }
    }

    commentIdsArray.forEach(n => {
      this.processedCommentIds.add(n);
      this.idToCommentNode.delete(n);
      this.idToUsertextNode.delete(n);
    });
  }

  /** Schedule fetch of pending comments */
  async fetchPendingComments(): Promise<void> {
    if (this.missingFieldBuckets.author.size === 0 && this.missingFieldBuckets.body.size === 0 && this.missingFieldBuckets.all.size === 0) return;

    const fetchPromises: Promise<void>[] = [];
    let fetchCount = 0;

    const removeCommentIds = async (commentIds: string[]): Promise<void> => {
      await Promise.all(commentIds.map(id => this.removeCommentIdFromBuckets(id)));
    };

    if (this.missingFieldBuckets.author.size > 0) {
      const authorIds = Array.from(this.missingFieldBuckets.author);
      fetchPromises.push(this.fetchCommentBatch(MsgType.COMMENTS_AUTHOR, authorIds));
      fetchCount += authorIds.length;
      await removeCommentIds(authorIds);
    }

    if (this.missingFieldBuckets.body.size > 0) {
      const bodyIds = Array.from(this.missingFieldBuckets.body);
      fetchPromises.push(this.fetchCommentBatch(MsgType.COMMENTS_BODY, bodyIds));
      fetchCount += bodyIds.length;
      await removeCommentIds(bodyIds);
    }

    if (this.missingFieldBuckets.all.size > 0) {
      const allIds = Array.from(this.missingFieldBuckets.all);
      fetchPromises.push(this.fetchCommentBatch(MsgType.COMMENTS_ALL, allIds));
      fetchCount += allIds.length;
      await removeCommentIds(allIds);
    }

    Promise.all(fetchPromises)
      .then(() => {
        console.debug('Fetched archive data for', fetchCount, 'comments');
      })
      .catch(error => {
        console.error('Error fetching archive data:', error);
      });
  }

  /** Process all existing comments on the page */
  async processExistingComments(): Promise<void> {
    const commentNodes = await this.getCommentNodes();

    commentNodes.forEach(commentNode => {
      this.processCommentNode(commentNode);
    });

    // Process any comments that had pending API responses from previous navigation
    await this.processPendingRequests();
    await this.fetchPendingComments();
  }

  /**
   * Reads a comment, determines if it is missing a field, and if so adds it to the appropriate bucket
   * @param commentNode - The comment node to process
   */
  async processCommentNode(commentNode: HTMLElement): Promise<void> {
    const commentId = await this.getCommentId(commentNode);
    if (!commentId) return;

    if (!this.idToCommentNode.has(commentId)) {
      this.idToCommentNode.set(commentId, commentNode as HTMLElement);
    }

    const usertextNode = await this.getCommentUsertextNode(commentNode);
    if (usertextNode && !this.idToUsertextNode.has(commentId)) {
      this.idToUsertextNode.set(commentId, usertextNode);
    }

    if (this.processedCommentIds.has(commentId)) return;
    if (this.scheduledCommentIds.has(commentId)) return;

    if (!(await this.expandCommentNode(commentNode))) {
      // Comment wasn't expanded, don't process it yet
      return;
    }

    const isBodyDeleted = await this.isCommentBodyDeleted(commentNode);
    const isAuthorDeleted = await this.isCommentAuthorDeleted(commentNode);

    if (!isBodyDeleted && !isAuthorDeleted) return;

    // Add loading indicator and metadata button to comments with missing data
    if (isBodyDeleted) {
      await this.showLoadingIndicator(commentId);
    }

    if (await this.isOnlyCommentAuthorDeleted(commentNode)) {
      this.missingFieldBuckets.author.add(commentId);
    } else if (await this.isOnlyCommentBodyDeleted(commentNode)) {
      this.missingFieldBuckets.body.add(commentId);
    } else {
      this.missingFieldBuckets.all.add(commentId);
    }

    commentNode.setAttribute('undeleted', 'true');
    this.scheduledCommentIds.add(commentId);
  }

  /** Checks for new comments and processes them */
  async processNewComments(): Promise<void> {
    const commentNodes = await this.getNewCommentNodes();
    commentNodes.forEach(commentNode => this.processCommentNode(commentNode));
  }

  /** Process the main post on the page */
  async processMainPost(): Promise<void> {
    const postNode = await this.getPostNode();
    if (postNode) {
      await this.fetchPostData(postNode);
    } else {
      console.warn('processMainPost() could not find the main post node');
    }
  }

  /**
   * Fetch data for a post
   * @param postNode - The post node
   */
  async fetchPostData(postNode: HTMLElement): Promise<void> {
    if (!postNode) {
      console.warn("Can't fetch post data without a post node");
      return;
    }

    let postId = await this.getPostId(postNode);
    if (!postId) {
      console.warn("Couldn't get post ID, trying based on URL");
      postId = (await this.getPostIdFromUrl()) || '';
      if (!postId || postId === '') {
        console.warn('Failed to get post ID');
        return;
      }
      const siteTable = document.getElementById('siteTable');
      let urlMatch = siteTable?.querySelector('div.thing');

      if (!(urlMatch && postNode === urlMatch)) {
        console.warn('Failed to get post ID');
        return;
      }
    }

    if (postNode.classList.contains('archive-processed')) {
      return;
    } else {
      postNode.classList.add('archive-processed');
    }

    const missingFields = await this.getMissingPostFields(postNode);
    if (missingFields.size === 0) {
      return;
    }

    const fields = Array.from(missingFields).join(',') + (missingFields.has('selftext') ? '&md2html=true' : '');

    try {
      const response = await chrome.runtime.sendMessage({
        type: MsgType.MAIN_POST,
        postIdStr: postId,
        fields,
      });

      if (response && response.postData && response.postData[0]) {
        const author = response.postData[0]['author'] ? response.postData[0]['author'] : undefined;
        const title = response.postData[0]['title'] ? response.postData[0]['title'] : undefined;
        const selftext = response.postData[0]['selftext_html']
          ? response.postData[0]['selftext_html']
          : response.postData[0]['selftext'] === ''
            ? "<div class='md'>[not found in archive]</div>"
            : undefined;

        await this.updatePostNode(postNode, author, selftext, title);
      } else {
        console.error('No response or postData from background script', response);
      }
    } catch (error) {
      console.error('Error fetching post data:', error);
    }
  }

  /**
   * Load settings from browser.storage.local into class variables
   * Must be awaited before calling any methods that read the associated variables
   */
  async loadSettings(): Promise<void> {
    chrome.storage.local.get(['expandCollapsedComments'], result => {
      this.shouldAutoExpand = result.expandCollapsedComments ?? true;
    });
  }

  /**
   * Determines which fields of a post are missing
   * @param postNode {HTMLElement} - The post node
   */
  async getMissingPostFields(postNode: HTMLElement): Promise<Set<string>> {
    const missingFields = new Set<string>();

    if (await this.isPostAuthorDeleted(postNode)) {
      missingFields.add('author');
    }
    if (await this.isPostBodyDeleted(postNode)) {
      missingFields.add('selftext');
    }
    if (await this.isPostTitleDeleted(postNode)) {
      missingFields.add('title');
    }

    return missingFields;
  }

  /** Get the post ID from the URL path */
  async getPostIdFromUrl(): Promise<string | null> {
    const match = window.location.pathname.match(/\/comments\/(\w+)/);
    if (match && match[1]) {
      return match[1];
    }
    return null;
  }

  /** Observe URL changes for client-side routing */
  async observeUrlChanges(): Promise<void> {
    let lastUrl = location.href;

    // Initial run for the first page load
    await this.runContentScript();

    // Observer function
    const urlChangeHandler = async () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;

        // Run the content script for the new page
        await this.runContentScript();
      }
    };

    // Use both history state changes and DOM mutations to detect navigation
    window.addEventListener('popstate', urlChangeHandler);

    // Observer for React router/client-side navigation
    const navObserver = new MutationObserver(this.debounce(urlChangeHandler, 30));
    navObserver.observe(document.body, { childList: true, subtree: true });

    // Start observing
    const urlObserver = new MutationObserver(this.debounce(urlChangeHandler, 30));
    urlObserver.observe(document, { subtree: true, childList: true });
  }

  /**
   * Start a mutation observer to watch for new comments
   * @param observeTarget - The element to observe for mutations
   */
  async observeNewComments(observeTarget: Node): Promise<void> {
    const debounceProcess = this.debounce(() => {
      if (!this.isUserAction) {
        this.processNewComments();
        this.fetchPendingComments();
      }
      this.isUserAction = false;
    }, 30);

    const observer = new MutationObserver(() => {
      // If this mutation was triggered by a user clicking to collapse/expand, set the flag to avoid processing
      if (
        document.activeElement &&
        ((document.activeElement as HTMLElement).classList.contains('expand') ||
          (document.activeElement as HTMLElement).classList.contains('collapse') ||
          (document.activeElement as HTMLElement).classList.contains('expando-button'))
      ) {
        this.isUserAction = true;
      }

      debounceProcess();
    });

    observer.observe(observeTarget, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'collapsed'],
    });
  }

  /** Run the content script for the current page */
  async runContentScript(): Promise<void> {
    const currentUrl = window.location.href;

    // Reset state for the new page context
    this.resetState();

    // Skip if this is not a comments page
    if (this.subredditUrlPattern.test(currentUrl) || !this.commentsPageUrlPattern.test(currentUrl)) {
      console.debug('Skipping url', currentUrl);
      return;
    }

    // Process the page content
    await this.processMainPost();
    await this.processExistingComments();

    // Mark this URL as processed
    this.processedUrls.add(currentUrl);
  }

  /** Reset state for a new page */
  resetState(): void {
    this.processedCommentIds.clear();
    this.scheduledCommentIds.clear();
    this.idToCommentNode.clear();
    this.idToUsertextNode.clear();
    this.missingFieldBuckets.author.clear();
    this.missingFieldBuckets.body.clear();
    this.missingFieldBuckets.all.clear();
    this.autoExpandedCommentIds.clear();
    this.cachedCommentIds.clear();
    this.alreadyExpandedOnce.clear();
  }

  /** Determine whether the current page is a single comment thread */
  async isSingleThreadPage(): Promise<boolean> {
    return this.singleThreadUrlPattern.test(window.location.href);
  }

  // Abstract methods to be implemented in subclasses:

  /**
   * Replace a comment with some text to indicate that it is loading
   * @param _commentId - The ID of the comment
   */
  async showLoadingIndicator(_commentId: string): Promise<void> {
    throw new Error('showLoadingIndicator() must be implemented by subclass');
  }

  /** Finds all comment nodes */
  async getCommentNodes(): Promise<NodeListOf<HTMLElement>> {
    throw new Error('getCommentNodes() must be implemented by subclass');
  }

  /** Finds any new comments that have not yet been processed */
  async getNewCommentNodes(): Promise<NodeListOf<HTMLElement>> {
    throw new Error('getNewCommentNodes() must be implemented by subclass');
  }

  /**
   * Finds the id of a comment
   * @param _commentNode - The comment node
   */
  async getCommentId(_commentNode: HTMLElement): Promise<string | null> {
    throw new Error('getCommentId() must be implemented by subclass');
  }

  /**
   * Finds the usertext node of a comment
   * @param _commentNode - The comment node
   */
  async getCommentUsertextNode(_commentNode: HTMLElement): Promise<HTMLElement | null> {
    throw new Error('getCommentUsertextNode() must be implemented by subclass');
  }

  /**
   * Finds the author node of a comment
   * @param _commentNode - The comment node
   */
  async getCommentAuthorNode(_commentNode: HTMLElement): Promise<HTMLElement | null> {
    throw new Error('getCommentAuthorNode() must be implemented by subclass');
  }

  /**
   * Check if the comment body is deleted
   * @param _commentNode - The comment node
   */
  async isCommentBodyDeleted(_commentNode: HTMLElement): Promise<boolean> {
    throw new Error('isCommentBodyDeleted() must be implemented by subclass');
  }

  /**
   * Check if the comment author is deleted
   * @param _commentNode - The comment node
   */
  async isCommentAuthorDeleted(_commentNode: HTMLElement): Promise<boolean> {
    throw new Error('isCommentAuthorDeleted() must be implemented by subclass');
  }

  /**
   * Check if the comment author is deleted and the comment body is not
   * @param _commentNode - The comment node
   */
  async isOnlyCommentAuthorDeleted(_commentNode: HTMLElement): Promise<boolean> {
    throw new Error('isOnlyCommentAuthorDeleted() must be implemented by subclass');
  }

  /**
   * Check if the comment body is deleted and the comment author is not
   * @param {HTMLElement} _commentNode
   * @returns {Promise<boolean>}
   */
  async isOnlyCommentBodyDeleted(_commentNode: HTMLElement): Promise<boolean> {
    throw new Error('isOnlyCommentBodyDeleted() must be implemented by subclass');
  }

  /**
   * Finds and replaces the author and body of a comment, and apply an outline to indicate it was replaced
   * @param {HTMLElement} _commentNode
   * @param {string} _id
   * @param {string} _author
   * @param {string} _usertext
   * @returns {Promise<void>}
   */
  async updateCommentNode(_commentNode: HTMLElement, _id: string, _author: string, _usertext: string): Promise<void> {
    throw new Error('updateCommentNode() must be implemented by subclass');
  }

  /**
   * Finds and replaces the author of a comment with a new link to the profile of the original author
   * @param {HTMLElement} _commentNode
   * @param {string} _author
   * @returns {Promise<void>}
   */
  async updateCommentAuthor(_commentNode: HTMLElement, _author: string): Promise<void> {
    throw new Error('updateCommentAuthor() must be implemented by subclass');
  }

  /**
   * Sanitize and replace the body of a comment with archived text
   * @param {HTMLElement} _commentNode
   * @param {string} _dirtyUsertext
   * @returns {Promise<void>}
   */
  async updateCommentBody(_commentNode: HTMLElement, _dirtyUsertext: string): Promise<void> {
    throw new Error('updateCommentBody() must be implemented by subclass');
  }

  /**
   * Finds the post node
   * @returns {Promise<HTMLElement | null>}
   */
  async getPostNode(): Promise<HTMLElement | null> {
    throw new Error('getPostNode() must be implemented by subclass');
  }

  /**
   * Finds the id of a post
   * @param {HTMLElement} _postNode
   * @returns {Promise<string | null>}
   */
  async getPostId(_postNode: HTMLElement): Promise<string | null> {
    throw new Error('getPostId() must be implemented by subclass');
  }

  /**
   * Gets the title node of a post
   * @param {HTMLElement} _postNode
   * @returns {Promise<HTMLLinkElement | null>}
   */
  async getPostTitleNode(_postNode: HTMLElement): Promise<HTMLLinkElement | null> {
    throw new Error('getPostTitleNode() must be implemented by subclass');
  }

  /**
   * Gets the body content node of a post
   * @param {HTMLElement} _postNode
   * @returns {Promise<HTMLElement | null>}
   */
  async getPostBodyNode(_postNode: HTMLElement): Promise<HTMLElement | null> {
    throw new Error('getPostBodyNode() must be implemented by subclass');
  }

  /**
   * Check if the post author is deleted
   * @param {HTMLElement} _postNode
   * @returns {Promise<boolean>}
   */
  async isPostAuthorDeleted(_postNode: HTMLElement): Promise<boolean> {
    throw new Error('isPostAuthorDeleted() must be implemented by subclass');
  }

  /**
   * Check if the post body is deleted
   * @param {HTMLElement} _postNode
   * @returns {Promise<boolean>}
   */
  async isPostBodyDeleted(_postNode: HTMLElement): Promise<boolean> {
    throw new Error('isPostBodyDeleted() must be implemented by subclass');
  }

  /**
   * Check if the post title is deleted
   * @param {HTMLElement} _postNode
   * @returns {Promise<boolean>}
   * @returns {Promise<boolean>}
   */
  async isPostTitleDeleted(_postNode: HTMLElement): Promise<boolean> {
    throw new Error('isPostTitleDeleted() must be implemented by subclass');
  }

  /**
   * @param {HTMLElement} _postNode
   * @param {string} _author
   * @param {string} _selftext
   * @param {string} _title
   * @returns {Promise<void>}
   */
  async updatePostNode(_postNode: HTMLElement, _author: string, _selftext: string, _title: string): Promise<void> {
    throw new Error('updatePostNode() must be implemented by subclass');
  }

  /**
   * Finds and replaces the author of a post with the given text.
   * @param {HTMLElement} _postNode
   * @param {string} _postAuthorText
   * @returns {Promise<void>}
   */
  async updatePostAuthor(_postNode: HTMLElement, _postAuthorText: string | null): Promise<void> {
    throw new Error('updatePostAuthor() must be implemented by subclass');
  }

  /**
   * Finds and replaces the body of a post with archived text, and apply an outline to indicate it was replaced
   * @param {HTMLElement} _postNode
   * @param {string} _dirtySelftextHtml
   * @returns {Promise<void>}
   */
  async updatePostBody(_postNode: HTMLElement, _dirtySelftextHtml: string | null): Promise<void> {
    throw new Error('updatePostBody() must be implemented by subclass');
  }

  /**
   * Finds and replaces the title of a post with the given text, and apply an outline to indicate it was replaced
   * @param {HTMLElement} _postNode
   * @param {string} _postTitleText
   * @returns {Promise<void>}
   */
  async updatePostTitle(_postNode: HTMLElement, _postTitleText: string | null): Promise<void> {
    throw new Error('updatePostTitle() must be implemented by subclass');
  }

  /**
   * Replace the author of a post or comment with the given text.
   * @param {HTMLElement} _authorNode
   * @param {string} _author
   * @returns {Promise<void>}
   */
  async replaceAuthorNode(_authorNode: HTMLElement, _author: string): Promise<void> {
    throw new Error('replaceAuthorNode() must be implemented by subclass');
  }

  /**
   * @param {HTMLElement} _containerNode
   * @param {string} _htmlContent
   * @param {Object} _styles
   * @param {string|null} _newId
   * @param {string|null} _newClassList
   * @param {string|null} _surroundWithDiv
   * @returns {Promise<void>}
   */
  async replaceContentBody(
    _containerNode: HTMLElement,
    _htmlContent: string,
    _styles: object = {},
    _newId: string | null = null,
    _newClassList: string | null = null,
    _surroundWithDiv: string | null = null,
  ): Promise<void> {
    throw new Error('replaceContentBody() must be implemented by subclass');
  }

  /**
   * Replaces an expando button with a new functional one
   * @param {HTMLElement} _originalButton
   * @param {string} _nodeIdToExpand
   * @returns {Promise<void>}
   */
  async replaceExpandoButton(_originalButton: HTMLElement, _nodeIdToExpand: string): Promise<void> {
    throw new Error('replaceExpandoButton() must be implemented by subclass');
  }

  /**
   * Gets the author node from a post or comment
   * @param {HTMLElement} _root
   * @returns {Promise<ChildNode | null>}
   */
  async getAuthorNode(_root: HTMLElement): Promise<ChildNode | null> {
    throw new Error('getAuthorNode() must be implemented by subclass');
  }

  /**
   * Adds a button to a comment node to open the archived data in a new tab
   * @param {HTMLElement} _commentNode
   * @returns {Promise<void>}
   */
  async addMetadataButton(_commentNode: HTMLElement): Promise<void> {
    throw new Error('addMetadataButton() must be implemented by subclass');
  }

  /**
   * Adds a custom archive button to the comment action row
   * @param {Element} _commentNode - The comment node
   * @param {string} _commentId - The comment ID
   * @param {string} _archiveUrl - URL to the archive data
   * @returns {Promise<void>}
   */
  async addCustomArchiveButton(_commentNode: HTMLElement, _commentId: string, _archiveUrl: string): Promise<void> {
    throw new Error('addCustomArchiveButton() must be implemented by subclass');
  }

  /**
   * Injects CSS to handle our custom slot in the action row's shadow DOM
   * @param {Element} _actionRow - The action row element
   * @param {string} _customSlotName - Our custom slot name
   * @returns {Promise<void>}
   */
  async injectCustomSlotStyles(_actionRow: HTMLElement, _customSlotName: string): Promise<boolean> {
    throw new Error('injectCustomSlotStyles() must be implemented by subclass');
  }

  /**
   *  Find the first comment on the page.
   *  @returns {Promise<HTMLElement | null>} Returns the first comment node.
   *  @throws {Error} Throws an error if not implemented by subclass.
   */
  async getFirstCommentNode(): Promise<HTMLElement | null> {
    throw new Error('getFirstCommentNode() must be implemented by subclass');
  }
}

import DOMPurify from 'dompurify'
import { RedditContentProcessor } from './common.js'
;(async function () {
  'use strict'

  class NewRedditContentProcessor extends RedditContentProcessor {
    constructor() {
      super()
    }

    async getCommentNodes() {
      return document.querySelectorAll('shreddit-comment')
    }

    async getNewCommentNodes() {
      return document.querySelectorAll('shreddit-comment:not([undeleted])')
    }

    async getCommentId(commentNode) {
      const thingId = commentNode.getAttribute('thingid').replace('t1_', '')
      if (await this.isValidRedditId(thingId)) {
        return thingId
      }
    }

    async getCommentUsertextNode(commentNode) {
      return commentNode.querySelector('div.md > div.inline-block > p')
    }

    async getCommentAuthorNode(commentNode) {
      const deletedAuthor = commentNode.querySelector('faceplate-tracker[noun="comment_deleted_author"]')
      if (deletedAuthor) {
        return deletedAuthor
      } else {
        return commentNode.querySelector('div[slot="commentMeta"] > faceplate-tracker[noun="comment_author"]')
      }
    }

    async isCommentBodyDeleted(commentNode) {
      if (commentNode.hasAttribute('deleted') || commentNode.getAttribute('is-comment-deleted') === 'true') {
        return true
      } else {
        const usertextNode = await this.getCommentUsertextNode(commentNode)
        if (usertextNode) {
          return this.DELETED_TEXT.has(usertextNode.textContent)
        }

        return false
      }
    }

    async isCommentAuthorDeleted(commentNode) {
      return this.DELETED_TEXT.has(commentNode.getAttribute('author')) || commentNode.getAttribute('is-author-deleted') === 'true'
    }

    async isOnlyCommentAuthorDeleted(commentNode) {
      return (await this.isCommentAuthorDeleted(commentNode)) && !(await this.isCommentBodyDeleted(commentNode))
    }

    async isOnlyCommentBodyDeleted(commentNode) {
      return !(await this.isCommentAuthorDeleted(commentNode)) && (await this.isCommentBodyDeleted(commentNode))
    }

    async showLoadingIndicator(commentId) {
      if (!this.idToUsertextNode.has(commentId)) return
      const usertextNode = this.idToUsertextNode.get(commentId)
      if (usertextNode) {
        const loadingIndicatorHTML = `
        <div class="md loading-indicator">
          <div class="inline-block">
            <p style="color: #666; font-style: italic">Loading from archive...</p>
          </div>
        </div>`

        const parser = new DOMParser()
        const loadingIndicator = parser.parseFromString(loadingIndicatorHTML, 'text/html').body.children[0]

        const container = usertextNode.closest('div.md')
        if (container) {
          container.replaceWith(loadingIndicator)
        }
      }
    }

    async updateCommentNode(commentNode, id, author, usertext) {
      if (author) {
        await this.updateCommentAuthor(commentNode, author)
      }
      if (usertext) {
        await this.updateCommentBody(commentNode, usertext)
      }
    }

    async updateCommentAuthor(commentNode, author) {
      if (!author) return
      const authorNode = await this.getCommentAuthorNode(commentNode)
      if (authorNode) {
        await this.replaceAuthorNode(authorNode, author)
      }
    }

    async updateCommentBody(commentNode, dirtyUsertext) {
      const usertext = DOMPurify.sanitize(dirtyUsertext, {
        USE_PROFILES: { html: true },
      })
      if (!usertext) return
      const usertextNode = await this.getCommentUsertextNode(commentNode)
      if (!usertextNode) return

      const usertextContainer = usertextNode.parentElement.parentElement
      if (usertextContainer) {
        await this.replaceContentBody(usertextContainer, usertext)
      }
    }

    async getPostNode() {
      return document.querySelector('shreddit-post')
    }

    async updatePostNode(postNode, postAuthorText, postSelftextHtml, postTitleText) {
      if (postAuthorText) {
        await this.updatePostAuthor(postNode, postAuthorText)
      }
      if (postSelftextHtml) {
        await this.updatePostBody(postNode, postSelftextHtml)
      }
      if (postTitleText) {
        await this.updatePostTitle(postNode, postTitleText)
      }
    }

    async updatePostAuthor(postNode, postAuthorText) {
      const postAuthorNode = postNode.querySelector('faceplate-tracker[noun="user_profile"]')
      if ((await this.isPostAuthorDeleted(postNode)) && postAuthorNode) {
        await this.replaceAuthorNode(postAuthorNode, postAuthorText)
      }
    }

    async updatePostBody(postNode, dirtyPostSelftextHtml) {
      const postSelftextHtml = DOMPurify.sanitize(dirtyPostSelftextHtml, {
        USE_PROFILES: { html: true },
      })
      if (!postSelftextHtml) return

      if (!(await this.isPostBodyDeleted(postNode))) return

      let replaceTarget = postNode.querySelector('div[slot="post-removed-banner"]')

      if (!replaceTarget) {
        let newReplaceTarget = document.createElement('div')
        postNode.appendChild(newReplaceTarget)

        replaceTarget = newReplaceTarget
      }

      await this.replaceContentBody(replaceTarget, postSelftextHtml, { marginTop: '.6rem' })
    }

    async updatePostTitle(postNode, postTitleText) {
      const postTitleNode = postNode.querySelector('h1[slot="title"]')
      if ((await this.isPostTitleDeleted(postNode)) && postTitleText) {
        const newTitle = document.createElement('h1')
        newTitle.setAttribute('slot', 'title')
        postTitleNode.classList.forEach(className => {
          newTitle.classList.add(className)
        })
        newTitle.textContent = postTitleText

        await this.applyStyles(newTitle, {
          outline: '#e85646 solid',
          display: 'inline-block',
          padding: '.3rem .3rem .4rem .5rem',
          width: 'fit-content',
          marginTop: '.3rem',
          marginBottom: '.5rem',
        })

        postTitleNode.replaceWith(newTitle)
      }
    }

    async getPostId(postNode) {
      const postId = postNode.getAttribute('id').replace('t3_', '')
      if (await this.isValidRedditId(postId)) {
        return postId
      } else {
        const matches = window.location.href.match(/\/comments\/([a-zA-Z0-9]{0,7})/)
        if (matches && (await this.isValidRedditId(matches[1]))) {
          return matches[1]
        }
      }
    }

    async isPostTitleDeleted(postNode) {
      const postTitle = postNode.getAttribute('post-title')
      if (postTitle) {
        return this.DELETED_TEXT.has(postTitle)
      }
    }

    async isPostBodyDeleted(postNode) {
      return (
        !!postNode.querySelector('div[slot="post-removed-banner"]') ||
        (!postNode.querySelector('div[slot="text-body"]') && !postNode.querySelector('div[slot="post-media-container"]'))
      )
    }

    async isPostAuthorDeleted(postNode) {
      const postAuthorNode = postNode.querySelector('faceplate-tracker[noun="user_profile"]')

      if (this.DELETED_TEXT.has(postNode.getAttribute('author'))) {
        return true
      } else if (postAuthorNode) {
        return this.DELETED_TEXT.has(postAuthorNode.textContent)
      }

      return false
    }

    async replaceAuthorNode(authorNode, author) {
      let newAuthorElement

      if (!this.DELETED_TEXT.has(author)) {
        newAuthorElement = document.createElement('a')
        newAuthorElement.href = `https://www.reddit.com/u/${author}/`
        newAuthorElement.textContent = author
      } else {
        newAuthorElement = document.createElement('span')
        newAuthorElement.textContent = '[not found in archive]'
      }

      await this.applyStyles(newAuthorElement, { color: '#e85646' })
      authorNode.replaceWith(newAuthorElement)
    }

    async replaceContentBody(containerNode, htmlContent, styles = {}, newId = null, newClassList = null, surroundWithDiv = null) {
      const parser = new DOMParser()
      const correctHtmlStr = htmlContent ? htmlContent : '<div slot="text-body">[not found in archive]</div>'
      let parsedHtml = parser.parseFromString(correctHtmlStr, 'text/html')
      if (parsedHtml && parsedHtml.body && parsedHtml.body.textContent && this.DELETED_TEXT.has(parsedHtml.body.textContent.trim())) {
        parsedHtml = parser.parseFromString('<div class="md"><p>[not found in archive]</p></div>', 'text/html')
      }

      const newContent = document.createElement('div')
      while (parsedHtml.body.firstChild) {
        newContent.appendChild(parsedHtml.body.firstChild)
      }

      await this.applyStyles(newContent, {
        outline: '#e85646 solid',
        display: 'inline-block',
        padding: '.4rem',
        width: 'fit-content',
        marginBottom: '.4rem',
        ...styles,
      })

      containerNode.replaceWith(newContent)
    }

    /**
     * Adds a metadata button to a comment node by fetching its comment ID and constructing an archive URL.
     * @param {HTMLElement} commentNode
     * @returns {Promise<void>}
     */
    async addMetadataButton(commentNode) {
      const commentId = await this.getCommentId(commentNode)
      const archiveUrl = `https://arctic-shift.photon-reddit.com/api/comments/ids?ids=${commentId}`
      await this.addCustomArchiveButton(commentNode, commentId, archiveUrl)
    }

    /**
     * Adds a custom archive button to the comment action row
     * @param {Element} commentNode - The comment node
     * @param {string} commentId - The comment ID
     * @param {string} archiveUrl - URL to the archive data
     */
    async addCustomArchiveButton(commentNode, commentId, archiveUrl) {
      if (this.processedCommentIds.has(commentId)) {
        return
      }

      const actionRow = commentNode.querySelector('shreddit-comment-action-row')
      if (!actionRow || !actionRow.shadowRoot) {
        console.warn("Couldn't find action row for comment", commentId)
        return
      }

      const customSlotName = 'archive-data-button'
      await this.injectCustomSlotStyles(actionRow, customSlotName)

      // noinspection CssUnresolvedCustomProperty
      const buttonHTML = `
        <a href="${archiveUrl}" target="_blank" rel="noopener noreferrer" slot="${customSlotName}" class="archive-data-button">
          <button style="height: var(--size-button-sm-h); font: var(--font-button-sm)" class="button border-md text-12 button-plain-weak inline-flex pr-sm">
            <span style="" class="flex items-center gap-2xs">
              <span class="self-end">
                <svg fill="none" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 22 22">
                  <path
                   d="M5 12V6C5 5.44772 5.44772 5 6 5H18C18.5523 5 19 5.44772 19 6V18C19 18.5523 18.5523 19 18 19H12M8.11111 12H12M12 12V15.8889M12 12L5 19"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke="var(--button-color-text)" />
                </svg>
              </span>
              <span>Open archive data</span>
            </span>        
          </button>
        </a>`

      // Parse the HTML and sanitize it
      const parser = new DOMParser()
      const parsedHtml = parser.parseFromString(buttonHTML, 'text/html')
      const newButton = DOMPurify.sanitize(parsedHtml.body.childNodes[0], {
        USE_PROFILES: { svg: true, html: true },
        ADD_ATTR: ['target', 'slot'],
        IN_PLACE: true,
      })
      // Append the new button to the action row
      actionRow.appendChild(newButton)
    }

    /**
     * Injects CSS to handle our custom slot in the action row's shadow DOM
     * @param {Element} actionRow - The action row element
     * @param {string} customSlotName - Our custom slot name
     */
    async injectCustomSlotStyles(actionRow, customSlotName) {
      if (actionRow.hasAttribute('reddit-uncensored-processed')) {
        return
      }

      // find the overflow menu, and modify its order to be higher than the new slot
      const overflowMenu = actionRow.querySelector('[slot="overflow"]')
      if (overflowMenu) {
        overflowMenu.style.order = '201'
      }

      const styleElement = document.createElement('style')
      styleElement.textContent = `
        ::slotted([slot="${customSlotName}"]) {
          order: 200; 
          display: inline-flex;
        }
        
        .flex.items-center.max-h-2xl.shrink {
          display: flex !important;
        }
      `

      actionRow.shadowRoot.appendChild(styleElement)

      const slotElement = document.createElement('slot')
      slotElement.name = customSlotName

      const shareSlot = actionRow.shadowRoot.querySelector('slot[name="comment-share"]')
      const actionItemsContainer = actionRow.shadowRoot.querySelector('.flex.items-center.max-h-2xl.shrink')

      if (shareSlot) {
        shareSlot.after(slotElement)
      } else if (actionItemsContainer) {
        actionItemsContainer.appendChild(slotElement) // Append to the end of the action items container as fallback
      } else {
        console.warn("Couldn't find a suitable place to insert archive button slot")
        return
      }

      actionRow.setAttribute('reddit-uncensored-processed', 'true')
    }

    /**
     * Add listener to handle user collapsed comments and track them in the userCollapsedComments set.
     * @returns {Promise<void>}
     */
    async addCollapseListener() {
      document.addEventListener('click', async event => {
        const commentElement = event.target.closest('shreddit-comment')
        if (commentElement) {
          const commentId = await this.getCommentId(commentElement)
          if (commentId) {
            setTimeout(() => {
              const shadowRoot = commentElement.shadowRoot
              if (shadowRoot) {
                const details = shadowRoot.querySelector('details')
                if (details && !details.open) {
                  this.userCollapsedComments.add(commentId)
                } else {
                  this.userCollapsedComments.delete(commentId)
                }
              }
            }, 50)
          }
        }
      })
    }
  }

  const processor = new NewRedditContentProcessor()
  await processor.loadSettings()
  await processor.addCollapseListener()
  await processor.processMainPost()
  await processor.processExistingComments()
  await processor.observeNewComments()
})()
  .then(() => {})
  .catch(e => console.error('error in reddit-uncensored content script:', e))

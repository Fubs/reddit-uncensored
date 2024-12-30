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

    async expandCommentNode(commentNode) {
      // Don't auto-expand if setting is disabled, or if the comment was already expanded once by this script.
      // The 'depth' !== '0' check is to fix an edge case when viewing of a single-comment-thread page with a deleted root comment
      if (
        (!this.shouldAutoExpand && commentNode.hasAttribute('collapsed')) ||
        (this.autoExpandedCommentIds.has(commentNode) && commentNode.getAttribute('depth') !== '0')
      ) {
        return false
      }

      commentNode.removeAttribute('collapsed')
      commentNode.classList.remove('collapsed')
      return true
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
        const loadingDiv = document.createElement('div')
        loadingDiv.className = 'md loading-indicator'
        const loadingInlineBlock = document.createElement('div')
        loadingInlineBlock.className = 'inline-block'
        loadingDiv.appendChild(loadingInlineBlock)
        const loadingP = document.createElement('p')
        loadingP.textContent = 'Loading from archive...'
        await this.applyStyles(loadingP, {
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
        ...styles,
      })

      containerNode.replaceWith(newContent)
    }
  }

  const processor = new NewRedditContentProcessor()
  await processor.loadSettings()
  await processor.processMainPost()
  await processor.processExistingComments()
  await processor.observeNewComments()
})()
  .then(() => {})
  .catch(e => console.error('error in reddit-uncensored content script:', e))

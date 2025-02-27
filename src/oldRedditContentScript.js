import DOMPurify from 'dompurify'
import { RedditContentProcessor } from './common.js'
;(async function () {
  'use strict'

  class OldRedditContentProcessor extends RedditContentProcessor {
    constructor() {
      super()
    }

    async showLoadingIndicator(commentId) {
      if (!this.idToUsertextNode.has(commentId)) return
      const usertextNode = this.idToUsertextNode.get(commentId)

      if (usertextNode) {
        const parser = new DOMParser()
        const loadingNodeHTML = `<div class="md loading-indicator"><p>Loading from archive...</p></div>`
        const parsedHtml = parser.parseFromString(loadingNodeHTML, 'text/html')
        await this.applyStyles(parsedHtml.body.childNodes[0], {
          color: 'gray',
          fontStyle: 'italic',
          padding: '0.4rem 0.4rem 0.2rem 0.4rem',
        })
        const container = usertextNode.closest('div.md-container')
        if (container) {
          container.replaceWith(parsedHtml.body.childNodes[0])
        }
      }
    }

    async getCommentNodes() {
      return document.querySelectorAll('div.comment')
    }

    async getNewCommentNodes() {
      return document.querySelectorAll('.comment:not([undeleted])')
    }

    async getCommentId(commentNode) {
      if (this.cachedCommentIds.has(commentNode)) {
        return this.cachedCommentIds.get(commentNode)
      }

      const dataFullname = commentNode.getAttribute('data-fullname')
      if (dataFullname) {
        const id = dataFullname.replace('t1_', '')
        if (await this.isValidRedditId(id)) {
          this.cachedCommentIds.set(commentNode, id)
          return id
        }
      }

      const permalink = commentNode.getAttribute('data-permalink')
      if (permalink) {
        const match = permalink.match(/\/comments\/[^/]+\/[^/]+\/([^/]+)/)
        if (match && match[1] && (await this.isValidRedditId(match[1]))) {
          this.cachedCommentIds.set(commentNode, match[1])
          return match[1]
        }
      }

      console.warn('Could not find comment ID')
      return null
    }

    async getCommentUsertextNode(commentNode) {
      return commentNode.querySelector('div.usertext-body > div.md')
    }

    async isCommentBodyDeleted(commentNode) {
      const usertextNode = commentNode.querySelector('div.md > p')
      if (usertextNode) {
        return this.DELETED_TEXT.has(usertextNode.textContent.trim())
      }
      return false
    }

    async isCommentAuthorDeleted(commentNode) {
      const a = await this.getAuthorNode(commentNode)
      if (a) {
        const textContent = a.textContent.trim()
        return this.DELETED_TEXT.has(textContent.trim())
      }
    }

    async isOnlyCommentAuthorDeleted(commentNode) {
      return (await this.isCommentAuthorDeleted(commentNode)) && !(await this.isCommentBodyDeleted(commentNode))
    }

    async isOnlyCommentBodyDeleted(commentNode) {
      return !(await this.isCommentAuthorDeleted(commentNode)) && this.isCommentBodyDeleted(commentNode)
    }

    async updateCommentNode(commentNode, id, author, usertext) {
      commentNode.classList.add('undeleted')
      commentNode.classList.remove('deleted')
      if (author) {
        await this.updateCommentAuthor(commentNode, author)
      }
      if (usertext) {
        await this.updateCommentBody(commentNode, usertext)
      }
      await this.addMetadataButton(commentNode)
      commentNode.classList.add('undeleted')
    }

    async updateCommentAuthor(commentNode, author) {
      if (!author) return
      await this.updateAuthorNode(commentNode, author)
      commentNode.classList.add('undeleted')
    }

    async updateCommentBody(commentNode, dirtyUsertext) {
      if (!dirtyUsertext) return
      const usertextNode = commentNode.querySelector('.md')
      if (usertextNode && (await this.isCommentBodyDeleted(commentNode))) {
        const sanitizedHtml = DOMPurify.sanitize(dirtyUsertext)

        await this.replaceContentBody(usertextNode, sanitizedHtml, {
          display: 'inline-block',
          padding: '.1rem .2rem .1rem .2rem',
          width: 'fit-content',
          border: '2px solid #e85646',
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

    async getPostNode() {
      return document.querySelector('div#siteTable').firstElementChild
    }

    async getPostId(postNode) {
      if (this.cachedPostId !== null) return this.cachedPostId

      if (postNode.hasAttribute('data-fullname')) {
        const postId = postNode.getAttribute('data-fullname').replace('t3_', '')
        if (await this.isValidRedditId(postId)) {
          this.cachedPostId = postId
          return postId
        }
      }

      const matchTarget = postNode.hasAttribute('data-permalink') ? postNode.getAttribute('data-permalink') : window.location.href

      const matches = matchTarget.match(/\/comments\/([a-zA-Z0-9]{1,7})\//)
      if (matches && (await this.isValidRedditId(matches[1]))) {
        this.cachedPostId = matches[1]
        return matches[1]
      } else {
        throw new Error("couldn't get post id")
      }
    }

    async getPostTitleNode(postNode) {
      return postNode.querySelector('div.top-matter > p.title > a.title')
    }

    async getPostBodyNode(postNode) {
      const bodyNode = postNode.querySelector('div.expando > form > div.md-container')
      return bodyNode ? bodyNode : document.querySelector('div.usertext-body.md-container')
    }

    async isPostTitleDeleted(postNode) {
      const postTitleNode = await this.getPostTitleNode(postNode)
      return !postNode.classList.contains('undeleted') && postTitleNode && this.DELETED_TEXT.has(postTitleNode.textContent.trim())
    }

    async isPostBodyDeleted(postNode) {
      if (postNode.classList.contains('undeleted')) return false
      if (postNode.classList.contains('deleted')) return true

      const bodyNode = await this.getPostBodyNode(postNode)

      if (bodyNode.classList.contains('admin_takedown')) return true

      const usertextNode = postNode.querySelector('div.entry div.usertext-body > div.md > p')

      if (usertextNode) {
        return this.DELETED_TEXT.has(usertextNode.textContent.trim())
      }

      // check if the url was replaced with .../removed_by_reddit/
      // if url was changed to .../removed_by_reddit/, then body was deleted
      if (postNode.hasAttribute('data-permalink')) {
        return postNode.getAttribute('data-permalink').includes('/removed_by_reddit/')
      } else if (postNode.hasAttribute('data-url')) {
        return postNode.getAttribute('data-url').includes('/removed_by_reddit/')
      } else if (RegExp(/comments\/[a-zA-Z0-9]{1,8}\/removed_by_reddit\/[a-zA-Z0-9]{1,8}\//g).test(window.location.href)) {
        return true
      }
      return false
    }

    async isPostAuthorDeleted(postNode) {
      const postAuthorNode = await this.getAuthorNode(postNode)
      if (!postAuthorNode) {
        console.log('postAuthorNode is null')
        return false
      }
      return this.DELETED_TEXT.has(postAuthorNode.textContent.trim())
    }

    async updatePostAuthor(postNode, author) {
      if (author) {
        await this.updateAuthorNode(postNode, author)
      } else {
        await this.updateAuthorNode(postNode, '[not found in archive]')
      }
    }

    /**
     * Updates the author node with new author information
     * @param {HTMLElement} rootNode
     * @param {string} author
     */
    async updateAuthorNode(rootNode, author) {
      const authorNode = await this.getAuthorNode(rootNode)
      if (authorNode) {
        await this.replaceAuthorNode(authorNode, author)
      }
    }

    async updatePostBody(postNode, dirtySelftextHtml) {
      let expandoNode = postNode.querySelector('div.entry > div.expando')
      const replacementId = Math.random().toString(36).slice(2)

      let replaceTarget
      if (expandoNode) {
        replaceTarget = expandoNode
      } else {
        let newContainer = document.createElement('div')
        newContainer.id = replacementId
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
        await this.replaceExpandoButton(brokenExpandoBtn, replacementId)
      }

      const sanitizedHtml = DOMPurify.sanitize(dirtySelftextHtml, {
        USE_PROFILES: { html: true },
      })

      await this.replaceContentBody(
        replaceTarget,
        sanitizedHtml,
        {
          padding: '.3rem',
          border: '2px solid #e85646',
        },
        'usertext-body',
        replacementId,
        'expando',
      )

      const p = document.getElementById(replacementId)
      extraPostItems.forEach(item => {
        p.insertBefore(item, p.lastChild)
      })
    }

    async updatePostTitle(postNode, title) {
      const newTitleText = title ? title : "<h1 class='title'>[not found in archive]</h1>"
      const postTitleNode = await this.getPostTitleNode(postNode)
      if ((await this.isPostTitleDeleted(postNode)) && newTitleText) {
        const newTitle = document.createElement('a')
        newTitle.href = postTitleNode.href
        newTitle.textContent = newTitleText

        await this.applyStyles(newTitle, {
          border: '2px solid #e85646',
          display: 'inline-block',
          padding: '.3rem',
          width: 'fit-content',
        })

        postTitleNode.replaceWith(newTitle)
      }
    }

    async updatePostNode(postNode, postAuthorText, postSelftextHtml, postTitleText) {
      if (await this.isPostAuthorDeleted(postNode)) await this.updatePostAuthor(postNode, postAuthorText ? postAuthorText : null)
      if (await this.isPostBodyDeleted(postNode)) await this.updatePostBody(postNode, postSelftextHtml ? postSelftextHtml : null)
      if (await this.isPostTitleDeleted(postNode)) await this.updatePostTitle(postNode, postTitleText ? postTitleText : null)

      postNode.classList.remove('deleted')
      postNode.classList.add('undeleted')
    }

    async replaceAuthorNode(authorNode, author) {
      const newAuthorElement = author === '[deleted]' ? document.createElement('span') : document.createElement('a')
      newAuthorElement.textContent = author === '[deleted]' ? '[not found in archive]' : author
      newAuthorElement.href = author === '[deleted]' ? null : `https://old.reddit.com/u/${author}/`

      await this.applyStyles(newAuthorElement, { color: '#e85646', fontWeight: 'bold' })
      authorNode.replaceWith(newAuthorElement)
    }

    async replaceContentBody(containerNode, htmlContent, styles = {}, newId = null, newClassList = null, surroundWithDiv = null) {
      if (!containerNode) {
        console.warn('Container node is null or undefined')
        return
      }

      const parser = new DOMParser()
      const correctHtmlStr = htmlContent ? htmlContent : '<div class="md"><p>[not found in archive]</p></div>'
      let parsedHtml = parser.parseFromString(correctHtmlStr, 'text/html')
      if (parsedHtml && parsedHtml.body && parsedHtml.body.textContent && this.DELETED_TEXT.has(parsedHtml.body.textContent.trim())) {
        parsedHtml = parser.parseFromString('<div class="md"><p>[not found in archive]</p></div>', 'text/html')
      }

      if (parsedHtml.body.hasChildNodes()) {
        let newMdContainer = parsedHtml.body.childNodes[0]

        Array.from(parsedHtml.body.childNodes)
          .slice(1)
          .forEach(node => {
            newMdContainer.appendChild(node)
          })

        await this.applyStyles(newMdContainer, {
          ...styles,
        })

        if (surroundWithDiv) {
          const surroundingDiv = document.createElement('div')
          surroundingDiv.classList.add(...surroundWithDiv.split(' '))
          await this.applyStyles(surroundingDiv, {
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

    async replaceExpandoButton(originalButton, nodeIdToExpand) {
      // the expando button on posts is just a toggle to show/hide the post body, but it will break when the post body is replaced with a new node
      // This function replaces the broken expando button with one that is linked with nodeToExpand

      let newBtnDiv = document.createElement('div')
      newBtnDiv.classList.add('expando-button', 'hide-when-pinned', 'selftext', 'expanded')

      newBtnDiv.onclick = function () {
        if (document.getElementById(nodeIdToExpand).style.display === 'none' || document.getElementById(nodeIdToExpand).style.display === '') {
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

    async getAuthorNode(root) {
      const candidate1 = root.querySelector('p.tagline').firstChild.nextSibling

      if (candidate1 && this.DELETED_TEXT.has(candidate1.textContent.trim())) {
        return candidate1
      }

      const candidate2 = root.querySelector('p.tagline > span')

      if (candidate2 && this.DELETED_TEXT.has(candidate2.textContent.trim())) {
        return candidate2
      }

      const candidate3 = root.querySelector('p.tagline > a.author')

      if (candidate3 && this.DELETED_TEXT.has(candidate3.textContent.trim())) {
        return candidate3
      }

      const candidate4 = root.querySelector('p.tagline > a.author')

      if (candidate4) {
        return candidate4
      }

      return null
    }

    async addMetadataButton(commentNode) {
      if (commentNode.querySelector('.metadata-button')) return

      const commentID = await this.getCommentId(commentNode)
      if (!commentID) return

      const flatListButtons = commentNode.querySelector('ul.flat-list.buttons')
      if (!flatListButtons) {
        console.warn('Failed to add metadata button for comment', commentID)
      }

      const li = document.createElement('li')
      const a = document.createElement('a')
      a.href = `https://arctic-shift.photon-reddit.com/api/comments/ids?ids=${commentID}&md2html=true`
      a.textContent = 'open archive data'
      a.className = 'metadata-button'
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      li.appendChild(a)
      flatListButtons.appendChild(DOMPurify.sanitize(li, { USE_PROFILES: { html: true }, IN_PLACE: true, ADD_ATTR: ['target'] }))
    }

    /**
     * Add listener to handle user collapsed comments
     * @returns {Promise<void>}
     */
    async addCollapseListener() {
      document.addEventListener('click', async event => {
        // Check if the click was on an expand/collapse link
        if (event.target.classList.contains('expand') || event.target.closest('a.expand')) {
          // Find the comment node
          const commentNode = event.target.closest('.thing.comment')
          if (commentNode) {
            const commentId = await this.getCommentId(commentNode)
            if (commentId) {
              // Add a small delay to let the native collapse happen first
              setTimeout(() => {
                if (commentNode.classList.contains('collapsed')) {
                  // User has collapsed this comment
                  this.userCollapsedComments.add(commentId)
                } else {
                  // User has expanded this comment
                  this.userCollapsedComments.delete(commentId)
                }
              }, 50)
            }
          }
        }
      })
    }
  }

  const processor = new OldRedditContentProcessor()
  await processor.loadSettings()
  await processor.addCollapseListener()
  await processor.processMainPost()
  await processor.processExistingComments()
  await processor.observeNewComments()
})()
  .then(() => {})
  .catch(e => console.error('error in reddit-uncensored content script:', e))

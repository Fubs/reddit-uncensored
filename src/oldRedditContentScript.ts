import DOMPurify from 'dompurify';
import { RedditContentProcessor } from './common';

(async function () {
  'use strict';

  class OldRedditContentProcessor extends RedditContentProcessor {
    constructor() {
      super();
    }

    async showLoadingIndicator(commentId: string): Promise<void> {
      if (!this.idToUsertextNode.has(commentId)) return;
      const usertextNode = this.idToUsertextNode.get(commentId);

      if (usertextNode) {
        const parser = new DOMParser();
        const loadingNodeHTML = `<div class="md loading-indicator"><p>Loading from archive...</p></div>`;
        const parsedHtml = parser.parseFromString(loadingNodeHTML, 'text/html');
        await this.applyStyles(parsedHtml.body.childNodes[0] as HTMLElement, {
          color: 'gray',
          fontStyle: 'italic',
          padding: '0.4rem 0.4rem 0.2rem 0.4rem',
        });
        const container = usertextNode.closest('div.md-container');
        if (container) {
          container.replaceWith(parsedHtml.body.childNodes[0]);
        }
      }
    }

    async getCommentNodes(): Promise<NodeListOf<HTMLElement>> {
      return document.querySelectorAll('div.comment') as NodeListOf<HTMLElement>;
    }

    async getNewCommentNodes(): Promise<NodeListOf<HTMLElement>> {
      return document.querySelectorAll('.comment:not([undeleted])') as NodeListOf<HTMLElement>;
    }

    async getCommentId(commentNode: HTMLElement): Promise<string | null> {
      if (this.cachedCommentIds.has(commentNode)) {
        return this.cachedCommentIds.get(commentNode) || null;
      }

      const dataFullname = commentNode.getAttribute('data-fullname');
      if (dataFullname) {
        const id = dataFullname.replace('t1_', '');
        if (await this.isValidRedditId(id)) {
          this.cachedCommentIds.set(commentNode, id);
          return id;
        }
      }

      const permalink = commentNode.getAttribute('data-permalink');
      if (permalink) {
        const match = permalink.match(/\/comments\/[^/]+\/[^/]+\/([^/]+)/);
        if (match && match[1] && (await this.isValidRedditId(match[1]))) {
          this.cachedCommentIds.set(commentNode, match[1]);
          return match[1];
        }
      }

      console.warn('Could not find comment ID');
      return null;
    }

    async getCommentUsertextNode(commentNode: HTMLElement): Promise<HTMLElement | null> {
      return commentNode.querySelector('div.usertext-body > div.md') as HTMLElement | null;
    }

    async isCommentBodyDeleted(commentNode: HTMLElement): Promise<boolean> {
      const usertextNode = commentNode.querySelector('div.md > p');
      if (usertextNode) {
        return this.DELETED_TEXT.has(usertextNode.textContent?.trim() || '');
      }
      return false;
    }

    async isCommentAuthorDeleted(commentNode: HTMLElement): Promise<boolean> {
      if (commentNode.getAttribute('undeleted') === 'true') return false;
      const a = await this.getAuthorNode(commentNode);
      if (a) {
        const textContent = a.textContent?.trim() || '';
        return this.DELETED_TEXT.has(textContent);
      }
      return false;
    }

    async isOnlyCommentAuthorDeleted(commentNode: HTMLElement): Promise<boolean> {
      return (await this.isCommentAuthorDeleted(commentNode)) && !(await this.isCommentBodyDeleted(commentNode));
    }

    async isOnlyCommentBodyDeleted(commentNode: HTMLElement): Promise<boolean> {
      return !(await this.isCommentAuthorDeleted(commentNode)) && (await this.isCommentBodyDeleted(commentNode));
    }

    async updateCommentNode(commentNode: HTMLElement, _id: string, author: string, usertext: string): Promise<void> {
      commentNode.classList.add('undeleted');
      commentNode.classList.remove('deleted');
      if (author) {
        await this.updateCommentAuthor(commentNode, author);
      }
      if (usertext) {
        await this.updateCommentBody(commentNode, usertext);
      }
      await this.addMetadataButton(commentNode);
      commentNode.classList.add('undeleted');
    }

    async updateCommentAuthor(commentNode: HTMLElement, author: string): Promise<void> {
      if (!author) return;
      await this.updateAuthorNode(commentNode, author);
      commentNode.classList.add('undeleted');
    }

    async updateCommentBody(commentNode: HTMLElement, dirtyUsertext: string): Promise<void> {
      if (!dirtyUsertext) return;
      const usertextNode = commentNode.querySelector('.md') as HTMLElement;
      if (usertextNode && (await this.isCommentBodyDeleted(commentNode))) {
        if (dirtyUsertext === '<div class="md"><p>[deleted]</p></div>') dirtyUsertext = '<div class="md"><p>[not found in archive]</p></div>';

        await this.replaceContentBody(usertextNode, DOMPurify.sanitize(dirtyUsertext || '', { USE_PROFILES: { html: true }, IN_PLACE: true }), {
          display: 'inline-block',
          padding: '.1rem .2rem .1rem .2rem',
          width: 'fit-content',
          border: '2px solid #e85646',
        });
      }
      commentNode.classList.add('undeleted');
      const takedown_div = commentNode.querySelector('div.admin_takedown');
      if (takedown_div) {
        takedown_div.classList.remove('admin_takedown');
      }

      const grayed_div = commentNode.querySelector('div.grayed');
      if (grayed_div) {
        grayed_div.classList.remove('grayed');
      }
    }

    async getPostNode(): Promise<HTMLElement | null> {
      const siteTable = document.querySelector('div#siteTable');
      return (siteTable?.firstElementChild as HTMLElement) || null;
    }

    async getPostId(postNode: HTMLElement): Promise<string> {
      if (this.cachedPostId !== null && this.cachedPostId !== undefined) return this.cachedPostId;

      if (postNode.hasAttribute('data-fullname')) {
        const postId = postNode.getAttribute('data-fullname')?.replace('t3_', '') || '';
        if (await this.isValidRedditId(postId)) {
          this.cachedPostId = postId;
          return postId;
        }
      }

      const matchTarget = postNode.hasAttribute('data-permalink') ? postNode.getAttribute('data-permalink') || '' : window.location.href;

      const matches = matchTarget.match(/\/comments\/([a-zA-Z0-9]{1,7})\//);
      if (matches && (await this.isValidRedditId(matches[1]))) {
        this.cachedPostId = matches[1];
        return matches[1];
      } else {
        throw new Error("couldn't get post id");
      }
    }

    async getPostTitleNode(postNode: HTMLElement): Promise<HTMLLinkElement | null> {
      return postNode.querySelector('div.top-matter > p.title > a.title') as HTMLLinkElement | null;
    }

    async getPostBodyNode(postNode: HTMLElement): Promise<HTMLElement | null> {
      const bodyNode = postNode.querySelector('div.expando > form > div.md-container') as HTMLElement;
      return bodyNode ? bodyNode : (document.querySelector('div.usertext-body.md-container') as HTMLElement | null);
    }

    async isPostTitleDeleted(postNode: HTMLElement): Promise<boolean> {
      const postTitleNode = await this.getPostTitleNode(postNode);
      return !postNode.classList.contains('undeleted') && !!postTitleNode && this.DELETED_TEXT.has(postTitleNode.textContent?.trim() || '');
    }

    async isPostBodyDeleted(postNode: HTMLElement): Promise<boolean> {
      if (postNode.classList.contains('undeleted')) return false;
      if (postNode.classList.contains('deleted')) return true;

      const bodyNode = await this.getPostBodyNode(postNode);
      if (!bodyNode) return false;

      if (bodyNode.classList.contains('admin_takedown')) return true;

      const usertextNode = postNode.querySelector('div.entry div.usertext-body');
      if (usertextNode) {
        return this.DELETED_TEXT.has(usertextNode.textContent?.trim() || '');
      }

      const altUsertextNode = postNode.querySelector('div.entry div.usertext-body > div.md > p');
      if (altUsertextNode) {
        return this.DELETED_TEXT.has(altUsertextNode?.textContent?.trim() || '');
      }

      // check if the url was replaced with .../removed_by_reddit/
      // if url was changed to .../removed_by_reddit/, then body was deleted
      if (postNode.hasAttribute('data-permalink')) {
        return postNode.getAttribute('data-permalink')?.includes('/removed_by_reddit/') || false;
      } else if (postNode.hasAttribute('data-url')) {
        return postNode.getAttribute('data-url')?.includes('/removed_by_reddit/') || false;
      } else if (RegExp(/comments\/[a-zA-Z0-9]{1,8}\/removed_by_reddit\/[a-zA-Z0-9]{1,8}\//g).test(window.location.href)) {
        return true;
      }
      return false;
    }

    async isPostAuthorDeleted(postNode: HTMLElement): Promise<boolean> {
      const postAuthorNode = await this.getAuthorNode(postNode);
      if (!postAuthorNode) {
        console.warn('postAuthorNode is null');
        return false;
      }
      return this.DELETED_TEXT.has(postAuthorNode.textContent?.trim() || '');
    }

    async updatePostAuthor(postNode: HTMLElement, postAuthorText: string | null): Promise<void> {
      if (postAuthorText) {
        await this.updateAuthorNode(postNode, postAuthorText);
      } else {
        await this.updateAuthorNode(postNode, '[not found in archive]');
      }
    }

    /**
     * Updates the author node with new author information
     * @param rootNode - The root node containing the author
     * @param author - The new author name
     */
    async updateAuthorNode(rootNode: HTMLElement, author: string): Promise<void> {
      const authorNode = await this.getAuthorNode(rootNode);
      if (authorNode) {
        await this.replaceAuthorNode(authorNode as HTMLElement, author);
      }
    }

    async updatePostBody(postNode: HTMLElement, dirtySelftextHtml: string | null): Promise<void> {
      let expandoNode = postNode.querySelector('div.entry > div.expando');
      const replacementId = Math.random().toString(36).slice(2);
      const newContainerId = Math.random().toString(36).slice(2);

      let replaceTarget: HTMLElement;
      if (expandoNode) {
        replaceTarget = expandoNode as HTMLElement;
      } else {
        let newContainer = document.createElement('div');
        newContainer.id = newContainerId;
        const topMatter = postNode.querySelector('div.entry > div.top-matter');
        if (topMatter) {
          topMatter.after(newContainer);
        }

        replaceTarget = newContainer;
      }

      // save other non-deleted parts of the post before replacing expando, if any exist
      let extraPostItems: Node[] = [];
      if (expandoNode && expandoNode.querySelector(':scope > div:not(.usertext-body)')) {
        const items = Array.from(expandoNode.querySelectorAll(':scope > div:not(.usertext-body)')).map(node => node.cloneNode(true));
        extraPostItems = [...items];
      }

      const brokenExpandoBtn = postNode.querySelector('.expando-button');
      if (brokenExpandoBtn) {
        await this.replaceExpandoButton(brokenExpandoBtn as HTMLElement, replacementId);
      }

      await this.replaceContentBody(
        replaceTarget,
        DOMPurify.sanitize(dirtySelftextHtml || '', { USE_PROFILES: { html: true }, IN_PLACE: true }),
        {
          padding: '.3rem',
          border: '2px solid #e85646',
        },
        replacementId,
        'usertext-body',
        'expando',
      );

      const p = document.getElementById(replacementId);
      if (!p) {
        console.warn('Replacement element is null or undefined');
      } else {
        if (extraPostItems.length > 0) {
          extraPostItems.forEach(item => {
            p.insertBefore(item, p.lastChild);
          });
        }
      }
    }

    async updatePostTitle(postNode: HTMLElement, postTitleText: string | null): Promise<void> {
      const newTitleText = postTitleText ? postTitleText : "<h1 class='title'>[not found in archive]</h1>";
      const postTitleNode = await this.getPostTitleNode(postNode);
      if ((await this.isPostTitleDeleted(postNode)) && newTitleText && postTitleNode) {
        const newTitle = document.createElement('a');
        newTitle.href = postTitleNode.href;
        newTitle.textContent = newTitleText;

        await this.applyStyles(newTitle, {
          border: '2px solid #e85646',
          display: 'inline-block',
          padding: '.3rem',
          width: 'fit-content',
        });

        postTitleNode.replaceWith(newTitle);
      }
    }

    async updatePostNode(postNode: HTMLElement, postAuthorText: string, postSelftextHtml: string, postTitleText: string): Promise<void> {
      if (await this.isPostAuthorDeleted(postNode)) await this.updatePostAuthor(postNode, postAuthorText ? postAuthorText : null);
      if (await this.isPostBodyDeleted(postNode)) await this.updatePostBody(postNode, postSelftextHtml ? postSelftextHtml : null);
      if (await this.isPostTitleDeleted(postNode)) await this.updatePostTitle(postNode, postTitleText ? postTitleText : null);

      postNode.classList.remove('deleted');
      postNode.classList.add('undeleted');
    }

    async replaceAuthorNode(authorNode: HTMLElement, author: string): Promise<void> {
      const newAuthorElement = author === '[deleted]' ? document.createElement('span') : document.createElement('a');
      newAuthorElement.textContent = author === '[deleted]' ? '[not found in archive]' : author;
      if (newAuthorElement instanceof HTMLAnchorElement && author !== '[deleted]') {
        newAuthorElement.href = `https://old.reddit.com/u/${author}/`;
      }

      await this.applyStyles(newAuthorElement, { color: '#e85646', fontWeight: 'bold' });
      authorNode.replaceWith(newAuthorElement);
    }

    async replaceContentBody(
      containerNode: HTMLElement,
      htmlContent: string,
      styles: Partial<CSSStyleDeclaration> = {},
      newId: string | null = null,
      newClassList: string | null = null,
      surroundWithDiv: string | null = null,
    ): Promise<void> {
      if (!containerNode) {
        console.warn('Container node is null or undefined');
        return;
      }

      const parser = new DOMParser();
      if (htmlContent === '<div class="md"><p>[deleted]</p></div>' || htmlContent === '') htmlContent = '<div class="md"><p>[not found in archive]</p></div>';
      const correctHtmlStr = htmlContent ? htmlContent : '<div class="md"><p>[not found in archive]</p></div>';
      let parsedHtml = parser.parseFromString(correctHtmlStr, 'text/html');
      if (parsedHtml && parsedHtml.body && parsedHtml.body.textContent && this.DELETED_TEXT.has(parsedHtml.body.textContent.trim())) {
        parsedHtml = parser.parseFromString('<div class="md"><p>[not found in archive]</p></div>', 'text/html');
      }

      if (parsedHtml.body.hasChildNodes()) {
        let newMdContainer = parsedHtml.body.childNodes[0] as HTMLElement;

        Array.from(parsedHtml.body.childNodes)
          .slice(1)
          .forEach(node => {
            newMdContainer.appendChild(node);
          });

        await this.applyStyles(newMdContainer, {
          ...styles,
        });

        if (surroundWithDiv) {
          const surroundingDiv = document.createElement('div');
          surroundingDiv.classList.add(...surroundWithDiv.split(' '));
          await this.applyStyles(surroundingDiv, {
            display: 'block',
          });
          surroundingDiv.appendChild(newMdContainer);
          if (newId) {
            surroundingDiv.id = newId;
          }
          containerNode.replaceWith(surroundingDiv);
        } else {
          if (newId) {
            newMdContainer.id = newId;
          }
          if (newClassList) {
            newMdContainer.classList.add(...newClassList.split(' '));
          }

          containerNode.replaceWith(newMdContainer);
        }
      }
    }

    async replaceExpandoButton(originalButton: HTMLElement, nodeIdToExpand: string): Promise<void> {
      // the expando button on posts is just a toggle to show/hide the post body, but it will break when the post body is replaced with a new node
      // This function replaces the broken expando button with one that is linked with nodeToExpand

      let newBtnDiv = document.createElement('div');
      newBtnDiv.classList.add('expando-button', 'hide-when-pinned', 'selftext', 'expanded');

      newBtnDiv.onclick = function () {
        const expandNode = document.getElementById(nodeIdToExpand);
        if (!expandNode) return;

        if (expandNode.style.display === 'none' || expandNode.style.display === '') {
          expandNode.style.display = 'block';
          newBtnDiv.classList.add('expanded');
          newBtnDiv.classList.remove('collapsed');
        } else {
          expandNode.style.display = 'none';
          newBtnDiv.classList.add('collapsed');
          newBtnDiv.classList.remove('expanded');
        }
      };

      originalButton.replaceWith(newBtnDiv);
    }

    async getAuthorNode(root: HTMLElement): Promise<ChildNode | null> {
      const candidate1 = root.querySelector('p.tagline')?.firstChild?.nextSibling;

      if (candidate1 && this.DELETED_TEXT.has(candidate1.textContent?.trim() || '')) {
        return candidate1;
      }

      const candidate2 = root.querySelector('p.tagline > span');

      if (candidate2 && this.DELETED_TEXT.has(candidate2.textContent?.trim() || '')) {
        return candidate2;
      }

      const candidate3 = root.querySelector('p.tagline > a.author');

      if (candidate3 && this.DELETED_TEXT.has(candidate3.textContent?.trim() || '')) {
        return candidate3;
      }

      const candidate4 = root.querySelector('p.tagline > a.author');

      if (candidate4) {
        return candidate4;
      }

      return null;
    }

    async addMetadataButton(commentNode: HTMLElement): Promise<void> {
      if (commentNode.querySelector('.metadata-button')) return;

      const commentID = await this.getCommentId(commentNode);
      if (!commentID) return;

      const flatListButtons = commentNode.querySelector('ul.flat-list.buttons');
      if (!flatListButtons) {
        console.warn('Failed to add metadata button for comment', commentID);
        return;
      }

      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `https://arctic-shift.photon-reddit.com/api/comments/ids?ids=${commentID}&md2html=true`;
      a.textContent = 'open archive data';
      a.className = 'metadata-button';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      li.appendChild(a);
      flatListButtons.appendChild(DOMPurify.sanitize(li, { USE_PROFILES: { html: true }, IN_PLACE: true, ADD_ATTR: ['target'] }) as Node);
    }

    async getFirstCommentNode(): Promise<HTMLElement | null> {
      return document.querySelector('div.commentarea > div.sitetable > div.comment') as HTMLElement | null;
    }
  }

  const processor = new OldRedditContentProcessor();
  await processor.loadSettings();
  await processor.observeUrlChanges();
  await processor.observeNewComments(document.body);
})()
  .then(() => {})
  .catch(e => console.error('error in reddit-uncensored content script:', e));

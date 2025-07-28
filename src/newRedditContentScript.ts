import DOMPurify from 'dompurify';
import { RedditContentProcessor } from './common';

(async function () {
  'use strict';

  class NewRedditContentProcessor extends RedditContentProcessor {
    constructor() {
      super();
    }

    async getCommentNodes(): Promise<NodeListOf<HTMLElement>> {
      return document.querySelectorAll('shreddit-comment') as NodeListOf<HTMLElement>;
    }

    async getNewCommentNodes(): Promise<NodeListOf<HTMLElement>> {
      return document.querySelectorAll('shreddit-comment:not([undeleted])') as NodeListOf<HTMLElement>;
    }

    async getCommentId(commentNode: HTMLElement): Promise<string | null> {
      const thingId = commentNode.getAttribute('thingid')?.replace('t1_', '');
      if (thingId && (await this.isValidRedditId(thingId))) {
        return thingId;
      }
      return null;
    }

    async getCommentUsertextNode(commentNode: HTMLElement): Promise<HTMLElement | null> {
      return commentNode.querySelector('div[slot="commentMeta"] + div > div.inline-block > p') as HTMLElement | null;
    }

    async getCommentAuthorNode(commentNode: HTMLElement): Promise<HTMLElement | null> {
      const deletedAuthor = commentNode.querySelector('faceplate-tracker[noun="comment_deleted_author"]') as HTMLElement | null;
      if (deletedAuthor) {
        return deletedAuthor;
      } else {
        return commentNode.querySelector('div[slot="commentMeta"] > faceplate-tracker[noun="comment_author"]') as HTMLElement | null;
      }
    }

    async isCommentBodyDeleted(commentNode: HTMLElement): Promise<boolean> {
      if (commentNode.hasAttribute('deleted') || commentNode.getAttribute('is-comment-deleted') === 'true') {
        return true;
      } else {
        const usertextNode = await this.getCommentUsertextNode(commentNode);
        if (usertextNode) {
          return this.DELETED_TEXT.has((usertextNode.textContent || '').trim());
        }

        return false;
      }
    }

    async isCommentAuthorDeleted(commentNode: HTMLElement): Promise<boolean> {
      return this.DELETED_TEXT.has((commentNode.getAttribute('author') || '').trim()) || commentNode.getAttribute('is-author-deleted') === 'true';
    }

    async isOnlyCommentAuthorDeleted(commentNode: HTMLElement): Promise<boolean> {
      return (await this.isCommentAuthorDeleted(commentNode)) && !(await this.isCommentBodyDeleted(commentNode));
    }

    async isOnlyCommentBodyDeleted(commentNode: HTMLElement): Promise<boolean> {
      return !(await this.isCommentAuthorDeleted(commentNode)) && (await this.isCommentBodyDeleted(commentNode));
    }

    async showLoadingIndicator(commentId: string): Promise<void> {
      if (!this.idToUsertextNode.has(commentId)) return;
      const usertextNode = this.idToUsertextNode.get(commentId);
      if (usertextNode) {
        const loadingIndicatorHTML = `
        <div class="md loading-indicator">
          <div class="inline-block">
            <p style="color: #666; font-style: italic">Loading from archive...</p>
          </div>
        </div>`;

        const parser = new DOMParser();
        const loadingIndicator = parser.parseFromString(loadingIndicatorHTML, 'text/html').body.children[0];

        const container = usertextNode.closest('div.md');
        if (container) {
          container.replaceWith(loadingIndicator);
        }
      }
    }

    async updateCommentNode(commentNode: HTMLElement, _id: string, author: string, usertext: string): Promise<void> {
      if (author) {
        await this.updateCommentAuthor(commentNode, author);
      }
      if (usertext) {
        await this.updateCommentBody(commentNode, usertext);
      }
      if (usertext || author) {
        await this.addMetadataButton(commentNode);
      }
      commentNode.setAttribute('undeleted', 'true');
      commentNode.removeAttribute('deleted');
      commentNode.removeAttribute('is-comment-deleted');
    }

    async updateCommentAuthor(commentNode: HTMLElement, author: string): Promise<void> {
      if (!author) return;
      const authorNode = await this.getCommentAuthorNode(commentNode);
      if (authorNode) {
        await this.replaceAuthorNode(authorNode, author);
      }
    }

    async updateCommentBody(commentNode: HTMLElement, dirtyUsertext: string): Promise<void> {
      const usertext = DOMPurify.sanitize(dirtyUsertext, {
        USE_PROFILES: { html: true },
        IN_PLACE: true,
      });
      if (!usertext) return;
      const usertextNode = await this.getCommentUsertextNode(commentNode);
      if (!usertextNode) return;

      const usertextContainer = usertextNode.parentElement?.parentElement;
      if (usertextContainer) {
        await this.replaceContentBody(usertextContainer, usertext);
      }
    }

    async getPostNode(): Promise<HTMLElement | null> {
      return document.querySelector('shreddit-post') as HTMLElement | null;
    }

    async updatePostNode(postNode: HTMLElement, postAuthorText: string, postSelftextHtml: string, postTitleText: string): Promise<void> {
      if (postAuthorText) {
        await this.updatePostAuthor(postNode, postAuthorText);
      }
      if (postSelftextHtml) {
        await this.updatePostBody(postNode, postSelftextHtml);
      }
      if (postTitleText) {
        await this.updatePostTitle(postNode, postTitleText);
      }
    }

    async updatePostAuthor(postNode: HTMLElement, postAuthorText: string | null): Promise<void> {
      const postAuthorNode = postNode.querySelector('faceplate-tracker[noun="user_profile"]') as HTMLElement | null;
      if ((await this.isPostAuthorDeleted(postNode)) && postAuthorNode) {
        await this.replaceAuthorNode(postAuthorNode, postAuthorText || '');
      }
    }

    async updatePostBody(postNode: HTMLElement, dirtySelftextHtml: string | null): Promise<void> {
      const postSelftextHtml = DOMPurify.sanitize(dirtySelftextHtml || '', {
        USE_PROFILES: { html: true },
        IN_PLACE: true,
      });
      if (!postSelftextHtml) return;

      if (!(await this.isPostBodyDeleted(postNode))) return;

      let replaceTarget = postNode.querySelector('div[slot="post-removed-banner"]') as HTMLElement | null;

      if (!replaceTarget) {
        let newReplaceTarget = document.createElement('div');
        postNode.appendChild(newReplaceTarget);

        replaceTarget = newReplaceTarget;
      }

      await this.replaceContentBody(replaceTarget as HTMLElement, postSelftextHtml, { marginTop: '.6rem' });
    }

    async updatePostTitle(postNode: HTMLElement, postTitleText: string | null): Promise<void> {
      const postTitleNode = postNode.querySelector('h1[slot="title"]') as HTMLElement | null;
      if ((await this.isPostTitleDeleted(postNode)) && postTitleText && postTitleNode) {
        const newTitle = document.createElement('h1');
        newTitle.setAttribute('slot', 'title');
        postTitleNode.classList.forEach(className => {
          newTitle.classList.add(className);
        });
        newTitle.textContent = postTitleText;

        await this.applyStyles(newTitle, {
          outline: '#e85646 solid',
          display: 'inline-block',
          padding: '.3rem .3rem .4rem .5rem',
          width: 'fit-content',
          marginTop: '.3rem',
          marginBottom: '.5rem',
        });

        postTitleNode.replaceWith(newTitle);
      }
    }

    async getPostId(postNode: HTMLElement | null): Promise<string | null> {
      // If postNode is null, try to get the post ID from the URL directly
      if (!postNode) {
        const matches = window.location.href.match(/\/comments\/([a-zA-Z0-9]{1,7})/);
        if (matches && (await this.isValidRedditId(matches[1]))) {
          return matches[1];
        }
        console.warn("Couldn't find post node and couldn't extract post ID from URL");
        return null;
      }

      // If postNode exists, try to get the ID from its attributes
      const postId = postNode.getAttribute('id')?.replace('t3_', '');
      if (postId && (await this.isValidRedditId(postId))) {
        return postId;
      }

      // Fallback to URL extraction
      const matches = window.location.href.match(/\/comments\/([a-zA-Z0-9]{1,7})/);
      if (matches && (await this.isValidRedditId(matches[1]))) {
        return matches[1];
      }

      console.warn("Couldn't extract post ID");
      return null;
    }

    async isPostTitleDeleted(postNode: HTMLElement): Promise<boolean> {
      const postTitle = postNode.getAttribute('post-title');
      if (postTitle) {
        return this.DELETED_TEXT.has(postTitle.trim());
      }
      return false;
    }

    async isPostBodyDeleted(postNode: HTMLElement): Promise<boolean> {
      return (
        !!postNode.querySelector('div[slot="post-removed-banner"]') ||
        (!postNode.querySelector('div[slot="text-body"]') && !postNode.querySelector('div[slot="post-media-container"]'))
      );
    }

    async isPostAuthorDeleted(postNode: HTMLElement): Promise<boolean> {
      const postAuthorNode = postNode.querySelector('faceplate-tracker[noun="user_profile"]');

      if (this.DELETED_TEXT.has((postNode.getAttribute('author') || '').trim())) {
        return true;
      } else if (postAuthorNode) {
        return this.DELETED_TEXT.has((postAuthorNode.textContent || '').trim());
      }

      return false;
    }

    async replaceAuthorNode(authorNode: HTMLElement, author: string): Promise<void> {
      let newAuthorElement: HTMLElement;

      if (!this.DELETED_TEXT.has(author)) {
        newAuthorElement = document.createElement('a');
        (newAuthorElement as HTMLAnchorElement).href = `https://www.reddit.com/u/${author}/`;
        newAuthorElement.textContent = author;
      } else {
        newAuthorElement = document.createElement('span');
        newAuthorElement.textContent = '[not found in archive]';
      }

      await this.applyStyles(newAuthorElement, { color: '#e85646' });
      authorNode.replaceWith(newAuthorElement);
    }

    async replaceContentBody(
      containerNode: HTMLElement,
      htmlContent: string,
      styles: Partial<CSSStyleDeclaration> = {},
      _newId: string | null = null,
      _newClassList: string | null = null,
      _surroundWithDiv: string | null = null,
    ): Promise<void> {
      const fragment = document.createDocumentFragment();
      const newContent = document.createElement('div');

      // Apply a red outline to the replaced block
      Object.assign(newContent.style, {
        outline: '#e85646 solid',
        padding: '.4rem',
        width: 'fit-content',
        marginBottom: '.4rem',
        ...styles,
      });

      const correctedHtmlContent =
        htmlContent === '<div class="md"><p>[deleted]</p></div>' || htmlContent === '<div class="md"><p>[removed]</p></div>' || htmlContent === ''
          ? '<div class="md"><div class="inline-block"><p class="undeleted">[not found in archive]</p></div></div>'
          : htmlContent;
      newContent.appendChild(DOMPurify.sanitize(correctedHtmlContent, { USE_PROFILES: { html: true }, IN_PLACE: true, RETURN_DOM_FRAGMENT: true }));
      fragment.appendChild(newContent);
      containerNode.replaceWith(fragment);
    }

    async addMetadataButton(commentNode: HTMLElement): Promise<void> {
      const commentId = await this.getCommentId(commentNode);
      if (!commentId) return;

      // check if metadata button already exists
      if (document.getElementById(`archive-data-button-${commentId}`)) {
        return;
      }

      const archiveUrl = `https://arctic-shift.photon-reddit.com/api/comments/ids?ids=${commentId}`;
      await this.addCustomArchiveButton(commentNode, commentId, archiveUrl);
    }

    async addCustomArchiveButton(commentNode: HTMLElement, commentId: string, archiveUrl: string): Promise<void> {
      if (this.processedCommentIds.has(commentId)) {
        return;
      }

      const actionRow = commentNode.querySelector('[slot="actionRow"]');
      if (!actionRow) {
        console.warn("Couldn't find place to put metadata button for comment", commentId);
        return;
      }

      const CUSTOM_SLOT_NAME = 'archive-data-button';

      const customSlotInjectResult = await this.injectCustomSlotStyles(actionRow as unknown as HTMLElement, CUSTOM_SLOT_NAME);
      if (!customSlotInjectResult) {
        console.warn('Failed to inject custom slot styles for comment', commentId, 'skipping open-in-archive button injection...');
        return;
      }

      const BUTTON_TEXT = 'Open archive data';

      const getExternalLinkIcon = () => `
        <svg fill="none" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 22 22">
          <path
            d="M5 12V6C5 5.44772 5.44772 5 6 5H18C18.5523 5 19 5.44772 19 6V18C19 18.5523 18.5523 19 18 19H12M8.11111 12H12M12 12V15.8889M12 12L5 19"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke="var(--button-color-text)" />
        </svg>
      `;

      const buttonHTML = `
        <a id="archive-data-button-${commentId}" 
           href="${archiveUrl}" 
           target="_blank" 
           rel="noopener noreferrer" 
           slot="${CUSTOM_SLOT_NAME}" 
           class="archive-data-button">
          <button class="button border-md text-12 button-plain-weak inline-flex pr-sm archive-button">
            <span class="flex items-center gap-2xs">
              <span class="self-end">${getExternalLinkIcon()}</span>
              <span>${BUTTON_TEXT}</span>
            </span>
          </button>
        </a>`;

      // Parse the HTML and sanitize it
      const parser = new DOMParser();
      const parsedHtml = parser.parseFromString(buttonHTML, 'text/html');
      const newButton = DOMPurify.sanitize(parsedHtml.body.childNodes[0], {
        USE_PROFILES: { svg: true, html: true },
        ADD_ATTR: ['target', 'slot'],
        IN_PLACE: true,
      });

      // Append the new button to the action row
      actionRow.appendChild(newButton as Node);

      // Add a class for styles instead of inline styles
      const styleSheet = document.createElement('style');
      styleSheet.textContent = `
        .archive-button {
          height: var(--size-button-sm-h);
          font: var(--font-button-sm);
        }
      `;
      document.head.appendChild(styleSheet);
    }

    async injectCustomSlotStyles(actionRow: HTMLElement, customSlotName: string): Promise<boolean> {
      // find the overflow menu, and modify its order to be higher than the new slot
      const styleElement = document.createElement('style');
      styleElement.textContent = `
        ::slotted([slot="${customSlotName}"]) {
          order: 200; 
          display: inline-flex;
        }
        
        .flex.items-center.max-h-2xl.shrink {
          display: flex !important;
        }
      `;

      actionRow.shadowRoot?.appendChild(styleElement);

      const slotElement = document.createElement('slot');
      slotElement.name = customSlotName;

      const srShareSlot = actionRow.shadowRoot?.querySelector('slot[name="comment-share"]');
      const srActionItemsContainer = actionRow.shadowRoot?.querySelector('.flex.items-center.shrink');

      if (srShareSlot) {
        srShareSlot.after(slotElement);
      } else if (srActionItemsContainer) {
        srActionItemsContainer.appendChild(slotElement); // Append to the end of the action items container as fallback
      } else {
        console.warn("Couldn't find a suitable place to insert archive button slot");
        return false;
      }

      actionRow.setAttribute('reddit-uncensored-processed', 'true');
      return true;
    }

    async getFirstCommentNode(): Promise<HTMLElement | null> {
      return document.querySelector('shreddit-comment-tree > shreddit-comment') as HTMLElement | null;
    }
  }

  const processor = new NewRedditContentProcessor();
  await processor.loadSettings();
  await processor.observeUrlChanges();
  await processor.observeNewComments(document.body);
})()
  .then(() => {})
  .catch(e => console.error('error in reddit-uncensored content script:', e));

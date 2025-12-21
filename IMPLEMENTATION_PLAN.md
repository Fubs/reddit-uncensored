# Implementation Plan: "Show Original" Button for Reddit Comments

## What This Extension Does

This is a Chrome/Firefox browser extension called "Reddit Uncensored" that restores deleted/removed Reddit comments by fetching archived data from the Arctic Shift API (https://arctic-shift.photon-reddit.com).

## Goal of This Change

**Current behavior**: Extension automatically detects deleted comments and restores them without user interaction.

**New behavior**: Add a "Show original" button to every comment. User clicks the button to fetch and display the archived version. No automatic detection or restoration.

---

## Project Structure

```
C:\Users\HP MEDIA\Desktop\nguyenvu\reddit-uncensored\
└── src/
    ├── background.ts              # Service worker, handles API requests
    ├── common.ts                  # Base class with shared logic (~980 lines)
    ├── newRedditContentScript.ts  # New Reddit (www.reddit.com) implementation
    ├── oldRedditContentScript.ts  # Old Reddit (old.reddit.com) implementation
    ├── options.ts                 # Settings page logic
    └── options.html               # Settings page UI
```

---

## How the Extension Works

### Comment Structure on New Reddit
- Comments are `<shreddit-comment>` custom elements (Web Components with shadow DOM)
- Each comment has a `thingid` attribute containing the comment ID (format: `t1_abc123`)
- Action buttons (Reply, Share, etc.) go in a slot called `[slot="actionRow"]`

### How to Add Buttons
The extension already has a pattern for adding buttons in `newRedditContentScript.ts`:
1. Find the action row: `commentNode.querySelector('[slot="actionRow"]')`
2. Inject CSS into shadow DOM using `injectCustomSlotStyles()` method
3. Create a button element with a `slot` attribute
4. Append the button to the action row

### How to Fetch from Arctic Shift API
The background script handles API calls. From content script:
```typescript
import { MsgType } from './background';

const response = await chrome.runtime.sendMessage({
  type: MsgType.COMMENTS_ALL,  // value is 3
  commentIds: ['abc123'],      // array of comment IDs without t1_ prefix
});

// Response structure:
// response.commentsData[0] = { author: 'username', body_html: '<div>...</div>' }
```

### How DOM Changes Are Detected
The extension uses a MutationObserver in `common.ts` method `observeNewComments()` that watches for new elements added to the page (when user scrolls, clicks "load more", etc.).

---

## Files to Modify

### 1. `src/common.ts`

#### Change 1: Add abstract method declaration

Find the section with abstract methods (around line 945-978) and add:

```typescript
/**
 * Add "Show original" buttons to all comments that don't have one yet
 */
async addShowOriginalButtonsToNewComments(): Promise<void> {
  throw new Error('addShowOriginalButtonsToNewComments() must be implemented by subclass');
}
```

#### Change 2: Modify `observeNewComments()` method

Find this code around line 609-615:
```typescript
const debounceProcess = this.debounce(() => {
  if (!this.isUserAction) {
    this.processNewComments();
    this.fetchPendingComments();
  }
  this.isUserAction = false;
}, 30);
```

Replace with:
```typescript
const debounceProcess = this.debounce(() => {
  if (!this.isUserAction) {
    this.addShowOriginalButtonsToNewComments();
  }
  this.isUserAction = false;
}, 30);
```

#### Change 3: Modify `runContentScript()` method

Find this code around line 640-658:
```typescript
async runContentScript(): Promise<void> {
  const currentUrl = window.location.href;
  this.resetState();

  if (this.subredditUrlPattern.test(currentUrl) || !this.commentsPageUrlPattern.test(currentUrl)) {
    console.debug('Skipping url', currentUrl);
    return;
  }

  await this.processMainPost();
  await this.processExistingComments();
  this.processedUrls.add(currentUrl);
}
```

Replace `await this.processExistingComments();` with `await this.addShowOriginalButtonsToNewComments();`:
```typescript
async runContentScript(): Promise<void> {
  const currentUrl = window.location.href;
  this.resetState();

  if (this.subredditUrlPattern.test(currentUrl) || !this.commentsPageUrlPattern.test(currentUrl)) {
    console.debug('Skipping url', currentUrl);
    return;
  }

  await this.processMainPost();
  await this.addShowOriginalButtonsToNewComments();
  this.processedUrls.add(currentUrl);
}
```

---

### 2. `src/newRedditContentScript.ts`

#### Change 1: Add `addShowOriginalButton()` method

Add this method to the `NewRedditContentProcessor` class (after `getFirstCommentNode()` method, before the closing brace of the class):

```typescript
async addShowOriginalButton(commentNode: HTMLElement): Promise<void> {
  const commentId = await this.getCommentId(commentNode);
  if (!commentId) return;

  // Skip if button already exists
  if (commentNode.hasAttribute('has-show-original-btn')) return;

  const actionRow = commentNode.querySelector('[slot="actionRow"]');
  if (!actionRow) return;

  // Inject slot styles into shadow DOM (reuse existing pattern)
  const SLOT_NAME = 'show-original-slot';
  const slotInjected = await this.injectCustomSlotStyles(actionRow as HTMLElement, SLOT_NAME);
  if (!slotInjected) return;

  // Create button matching Reddit's style
  const buttonHTML = `
    <button slot="${SLOT_NAME}"
            class="button border-md text-12 button-plain-weak inline-flex pr-sm show-original-btn"
            style="height: var(--size-button-sm-h); font: var(--font-button-sm);">
      <span>Show original</span>
    </button>
  `;

  const parser = new DOMParser();
  const button = parser.parseFromString(buttonHTML, 'text/html').body.firstChild as HTMLElement;

  // Add click handler
  button.onclick = async () => {
    await this.fetchAndShowOriginal(commentNode, commentId, button);
  };

  actionRow.appendChild(button);
  commentNode.setAttribute('has-show-original-btn', 'true');
}
```

#### Change 2: Add `fetchAndShowOriginal()` method

Add this method right after `addShowOriginalButton()`:

```typescript
async fetchAndShowOriginal(
  commentNode: HTMLElement,
  commentId: string,
  button: HTMLElement
): Promise<void> {
  // Show loading state
  const buttonSpan = button.querySelector('span');
  if (buttonSpan) buttonSpan.textContent = 'Loading...';
  (button as HTMLButtonElement).disabled = true;

  try {
    // Fetch from Arctic Shift via background script
    const response = await chrome.runtime.sendMessage({
      type: MsgType.COMMENTS_ALL,
      commentIds: [commentId],
    });

    if (response?.commentsData?.[0]) {
      const data = response.commentsData[0];

      // Display the original content using existing method
      await this.updateCommentNode(commentNode, commentId, data.author, data.body_html);

      if (buttonSpan) buttonSpan.textContent = 'Original shown';
    } else {
      if (buttonSpan) buttonSpan.textContent = 'Not found';
    }
  } catch (error) {
    console.error('Error fetching original:', error);
    if (buttonSpan) buttonSpan.textContent = 'Error - Retry';
    (button as HTMLButtonElement).disabled = false;
  }
}
```

#### Change 3: Add `addShowOriginalButtonsToNewComments()` method

Add this method right after `fetchAndShowOriginal()`:

```typescript
async addShowOriginalButtonsToNewComments(): Promise<void> {
  const comments = document.querySelectorAll('shreddit-comment:not([has-show-original-btn])');
  for (const comment of comments) {
    await this.addShowOriginalButton(comment as HTMLElement);
  }
}
```

#### Change 4: Add MsgType import

At the top of the file, make sure `MsgType` is imported:
```typescript
import { MsgType } from './background';
```

(Check if it's already imported - if `RedditContentProcessor` is imported from `'./common'`, you may need to add MsgType to the imports from `'./background'`)

---

## Summary of All Changes

| File | Line | Action | Description |
|------|------|--------|-------------|
| `src/common.ts` | ~945 | ADD | Abstract method `addShowOriginalButtonsToNewComments()` |
| `src/common.ts` | ~609-615 | MODIFY | Change `observeNewComments()` to call new method |
| `src/common.ts` | ~653 | MODIFY | Change `runContentScript()` to call new method |
| `src/newRedditContentScript.ts` | top | MODIFY | Ensure `MsgType` is imported from `./background` |
| `src/newRedditContentScript.ts` | ~408 | ADD | Method `addShowOriginalButton()` |
| `src/newRedditContentScript.ts` | ~440 | ADD | Method `fetchAndShowOriginal()` |
| `src/newRedditContentScript.ts` | ~470 | ADD | Method `addShowOriginalButtonsToNewComments()` |

---

## How to Test

1. Build the extension: `cd chrome && pnpm run build` (or `bun run build`)
2. Load the unpacked extension in Chrome from `chrome/dist/`
3. Go to any Reddit comments page on www.reddit.com
4. Each comment should have a "Show original" button in its action row
5. Click the button - it should show "Loading..." then display archived content
6. Scroll down or click "load more comments" - new comments should also get buttons
7. Navigate to a different post - buttons should appear on the new page

---

## Notes

- This only implements the New Reddit version (`newRedditContentScript.ts`)
- Old Reddit (`oldRedditContentScript.ts`) can be updated later with the same pattern
- The existing automatic restoration code can be cleaned up later (not urgent)
- Button styling uses Reddit's CSS variables so it matches the native look

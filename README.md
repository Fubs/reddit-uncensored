<p align="center">
    <img src="assets/icons/icon_256.png" alt="shared/icons/icon_256.png">
</p>

# Reddit Arctic Shift Integration

<b>Restore deleted posts and comments on Reddit using the [Arctic Shift API](https://github.com/ArthurHeitmann/arctic_shift/)</b>

## About

This extension will automatically restore deleted posts and comments as you browse Reddit.

Works on the current Reddit UI ([www.reddit.com](https://www.reddit.com/)) and on old Reddit ([old.reddit.com](https://old.reddit.com/))

#### Limitations

Some posts and comments are deleted before they can be archived by Arctic Shift.

Some comments which are visible on old reddit cannot be seen on new reddit. Depending on why a comment is deleted, new Reddit will show a comment as "Comment removed by moderator", "Comment deleted by user", or it will not show the comment
at all. This extension works by getting the IDs of deleted posts and comments from the HTML. Comments which have been deleted but are still visible on the page will have a comment IDs retreivable from the HTML, but comments which are
completely
hidden do not have a comment ID that can be retreived.

## Installing from Chrome Web Store, Firefox Add-on Store, or Edge Web Store

The extension is currently being reviewed by the Chrome and Firefox web stores and will be available soon.

## Bug Reports

If you find any bugs, feel free to open an issue. Please include the URL of the page on which you found the bug, which browser you are using, and any other browser extensions you are using that may be interfering with this one.

## Building the Extension Locally

This extension uses [pnpm](https://pnpm.io)'s workspace feature to separate firefox and chrome builds. You can install pnpm directly, but I recommend using [corepack](https://github.com/nodejs/corepack).

To build the extension, run

```bash
corepack enable
pnpm install
pnpm run build
```

#### Chrome

You can load the extension in chrome-based browsers by enabling developer mode on the `chrome://extensions` page, clicking on "Load unpacked", and selecting the `chrome/dist` folder created by `pnpm run build`.

Alternatively you can create a locally signed .crx file by using `chromium` from the command line (or `google-chrome` if you use use google chrome instead of
chromium):

```bash
cd chrome
chromium --pack-extension=./dist
```

or

```bash
cd chrome
google-chrome --pack-extension=./dist
```

That will create a .crx and .pem file in the `chrome` directory. Then just drag-and-drop the .crx file onto the `chrome://extensions` page to install it.

#### Firefox

You can go to the  `about:debugging` page, select "Load temporary Add-on", and select the `firefox/dist` folder created by `pnpm run build`.

However doing that will cause the extension to be removed after the browser is closed. You can install it persistently but only on the developer edition of firefox.

To install it persistnently in the developer edition, you must first set `xpinstall.signatures.required` to `false` in `about:config`. Then you can run

```bash
pnpm run pack:firefox
```

to create a .zip file in the `firefox/web-ext-artifacts` directory. This .zip can be installed on the Firefox developer edition extensions page (Open `about:addons` -> click cog wheel -> Install Add-on from file -> select the .zip in
`firefox/web-ext-artifacts`).

## Donations

This extension relies on the Artic Shift API, which is maintained and operated by Arthur Heitmann. If you would like to help cover the recurring costs of operating the Arctic Shift API, you can find donation links on his
page [here](https://github.com/ArthurHeitmann).

You can donate to me to support the development of this extension [here](https://www.paypal.com/donate/?business=ETLDAT6J53R74&no_recurring=0&item_name=Thanks+for+supporting+my+work%21&currency_code=USD). However, I would prefer you give
some or all of your
donation to support the continued operation of the Arctic Shift API. Servers aren't free!
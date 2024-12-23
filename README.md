<p align="center">
    <img src="assets/icons/icon_256.png" alt="shared/icons/icon_256.png">
</p>

# Reddit Arctic Shift Integration

<b>Restore deleted posts and comments on Reddit using the [Arctic Shift API](https://github.com/ArthurHeitmann/arctic_shift/)</b>

## About

This extension will automatically restore deleted posts and comments as you browse Reddit.

Works on the current Reddit UI ([www.reddit.com](https://www.reddit.com/)) and on old Reddit ([old.reddit.com](https://old.reddit.com/))

### Limitations

Some posts and comments are deleted before they can be archived by Arctic Shift.

Some comments which are visible on old reddit cannot be seen on new reddit. Depending on why a comment is deleted, new Reddit will show a comment as "Comment removed by moderator", "Comment deleted by user", or it will not show the comment
at all. This extension works by getting the IDs of deleted posts and comments from the HTML. Comments which have been deleted but are still visible on the page will have a comment IDs retreivable from the HTML, but comments which are
completely
hidden do not have a comment ID that can be retreived.

## Bug Reports

If you find any bugs, feel free to open an issue. Please include the URL of the page on which you found the bug, which browser you are using, and any other browser extensions you are using that may be interfering with this one.

## Donations

This extension relies on the Artic Shift API, which is maintained and operated by Arthur Heitmann. If you would like to help cover the recurring costs of operating the Arctic Shift API, you can find donation links on his
page [here](https://github.com/ArthurHeitmann).

You can donate to me to support the development of this extension [here](https://www.paypal.com/donate/?business=ETLDAT6J53R74&no_recurring=0&item_name=Thanks+for+supporting+my+work%21&currency_code=USD). However, I would prefer you give
some or all of your
donation to support the continued operation of the Arctic Shift API.
# MovieBot setup

About 10 minutes, all done in Telegram and on github.com.

## 1. Create your Telegram bot

1. In Telegram, open a chat with **@BotFather** (it has a blue check mark).
2. Send `/newbot`, then pick a display name and a username ending in `bot` (e.g. `uday_moviebot`).
3. BotFather replies with a **token** like `123456789:AA...`. Treat it like a password: anyone with it can send messages as your bot.
4. Open a chat with your new bot and send it any message, such as `hi`. A bot can't message you until you've written to it first.

**To alert a group instead** (for example, friends you go to movies with): create the group, add your bot to it, and send a message in the group.

## 2. Find your chat ID

In a browser, open this address with your token in place of `<TOKEN>`:

```
https://api.telegram.org/bot<TOKEN>/getUpdates
```

Find `"chat":{"id":` in the text. That number is your **chat ID**. For a group it starts with `-`; keep the minus sign. If the page shows `"result":[]`, send the bot another message and reload.

## 3. Add the two secrets to GitHub

In **github.com/uday89kumar/MovieBot** → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, add:

| Name | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | the token from BotFather |
| `TELEGRAM_CHAT_ID` | the chat ID from step 2 |

Secrets stay hidden even in a public repository.

## 4. Make the repository public

**Settings** → **General** → scroll to **Danger Zone** → **Change visibility** → **Public**.

Why: GitHub Actions is free and unlimited for public repositories. A private repository on a free account gets 2,000 minutes a month, and a 15-minute schedule would use several times that. Your code, `watches.json` and the alert issues become visible to anyone; the Telegram secrets do not.

GitHub pauses scheduled workflows in a public repo after **60 days without a commit** and emails you before it does. Editing `watches.json` counts as a commit; otherwise click **Enable workflow** on the Actions tab.

## 5. Check that Actions can create issues

**Settings** → **Actions** → **General** → **Workflow permissions**: choose **Read and write permissions** and save. Also check that **Issues** is ticked under **Settings** → **General** → **Features**.

## 6. Send a test message

**Actions** tab → **MovieBot seat monitor** → **Run workflow** → tick **"Only send a test message"** → **Run workflow**.

Within a minute you should get a Telegram message and see a "MovieBot test notification" issue. If the run fails, open it to read the error. Most often the token or chat ID was pasted with an extra space.

## 7. Add your first watch

Edit `watches.json`: copy the example entry, fill in your movie, theatre, format and seats, set `"enabled": true` (or delete that line), and commit. The [README](README.md) explains every field. The next scheduled run, within 15 minutes, starts watching.

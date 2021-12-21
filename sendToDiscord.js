require('dotenv').config()
const axios = require('axios') 
const TurndownService = require('turndown')
const { WebhookClient } = require('discord.js')

const turndownService = new TurndownService()
const webhooks = JSON.parse(process.env.WEBHOOK_URLS)

async function sendToDiscord(posts, page, cookies) {
    const send = async (i = 0) => {
        const post = posts[i]
        if (!post) return true

        console.log(i, post.id, post.date, post.timestamp)

        if (post.contentHtml) post.markdown = turndownService.turndown(post.contentHtml)
        if (post.background) post.images.push(post.background)

        const embeds = []
        const files = []

        let content = post.markdown
        if (post.markdown && post.markdown.length > 4096) {
            content = sliceString(post.markdown, 4096)
            files.push({
                attachment: Buffer.from(post.markdown),
                name: 'full_content.md'
            })
        }

        const avatarFileName = getFileName(post.authorAvatar)
        files.push({
            attachment: post.authorAvatar,
            name: avatarFileName
        })

        if (post.images.length && post.images[0]) {
            post.images.forEach(img => {
                const fileName = getFileName(img)
                embeds.push({
                    image: {
                        url: 'attachment://' + fileName
                    },
                    color: '#1877f2'
                })
                files.push({
                    attachment: img,
                    name: fileName
                })
            })
        } else {
            embeds.push({
                color: '#1877f2'
            })
        }

        if (post.file) {
            const xRequest = await new Promise(resolve => {
                page.once('request', interceptedRequest => {
                    interceptedRequest.abort()
                    resolve(interceptedRequest)
                })
                page.goto(post.file.url).catch(() => {})
            })
            await page.goto('about:blank')

            const options = {
                responseType: 'arraybuffer',
                headers: xRequest._headers
            }
            options.headers.Cookie = JSON.parse(cookies).map(ck => ck.name + '=' + ck.value).join(';')

            const res = await axios.get(xRequest._url, options)
            files.push({
                attachment: Buffer.from(res.data),
                name: post.file.name
            })
        }

        const embed = {
            author: {
                name: post.authorName,
                icon_url: 'attachment://' + avatarFileName,
                url: post.authorUrl,
            },
            url: post.permalink,
            title: post.groupName,
            description: content
        }
        embeds[0] = { ...embeds[0], ...embed }
        
        embeds[embeds.length - 1].timestamp = post.timestamp
        embeds[embeds.length - 1].footer = {
            text: post.activity ? post.authorName + post.activity : null
        }

        const n = i % webhooks.length
        const { id, token } = parseWebhookURL(webhooks[n])
        const webhookClient = new WebhookClient(id, token)

        try {
            await webhookClient.send({ content: post.url, embeds, files })
        } catch (err) {
            console.error(err.message)
            return await send(i)
        }

        return await send(i + 1)
    }
    return await send()
}

function sliceString(str, maxLen) {
    return str.slice(0, maxLen - 3) + '...'
}

function getFileName(url) {
    url = url.replace(/\?.+$/, '')
    return (url.match(/.+\/(.+)$/) || [])[1]
}

function parseWebhookURL(url) {
    const match = url.match(/.+\/(.+)\/(.+)$/)
    const id = match[1]
    const token = match[2]
    return { id, token }
}

module.exports = sendToDiscord

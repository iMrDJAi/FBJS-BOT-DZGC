require('dotenv').config()
const fs = require('fs')
const { FB } = require('@makepad/fbjs')
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const sendToDiscord = require('./sendToDiscord.js')

puppeteer.use(StealthPlugin())

;(async () => {
    const cookies = Buffer.from(process.env.FB_COOKIES, 'base64').toString()
    const fb = new FB({
        headless: true,
        cookiesString: cookies,
        height: 1400,
        dumpio: true,
        changeUserAgent: false
    })
    const browser = await launchBrowser(fb.options)
    fb.browser = browser
    await fb.init()

    const group = fb.group(process.env.FB_GROUP, 'CHRONOLOGICAL')

    let posts = []
    const state = loadState()

    let timeout
    const stop = async () => {
        clearTimeout(timeout)
        console.log('Stopping...')
        fb.close()
        process.exit(0)
    }
    timeout = setTimeout(stop, 5 * 60 * 1000)

    await new Promise(res => {
        group.getPosts(async post => {
            if (!post) {
                console.log('No more posts!')
                return res()
            }
            if (post.timestamp >= state.timestamp && !state.posts.includes(post.id)) {
                posts.push(post)
            } else {
                await group.stop()
                res()
            }
            console.log(posts.length, post.id, post.date, post.timestamp)
        }, undefined, true)
    })

    if (!posts.length) return stop()

    const timestamp = posts[0].timestamp
    const ids = posts.filter(post => post.timestamp === timestamp).map(post => post.id)
    saveState({ timestamp, posts: ids })

    const page = await group.context.newPage()
    await page.setRequestInterception(true)
    await page._client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: __dirname
    })

    posts = posts.reverse()

    console.log('Sending to Discord...')
    await sendToDiscord(posts, page, cookies)
    console.log('Done!')
    stop()
})()

async function launchBrowser(options) {
    const browserOptions = {
        headless: options.headless,
        dumpio: options.dumpio,
        defaultViewport: null,
        args: [
            '--no-sandbox',
            '--disable-setuid-sendbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
        ],
        executablePath: options.executablePath
    }
    if (options.maximized && !options.headless) {
        browserOptions.args.push('--start-maximized')
    } else {
        browserOptions.args.push(`--window-size=${options.width},${options.height}`)
    }
    if (!browserOptions.executablePath && (process.arch === 'arm' || process.arch === 'arm64')) {
        browserOptions.executablePath = 'chromium-browser'
    }

    const browser = await puppeteer.launch(browserOptions)
    return browser
}

function loadState(file = './state.json') {
    let state
    if (fs.existsSync(file)) {
        state = JSON.parse(fs.readFileSync(file, { encoding: 'utf8' }))
    } else {
        state = {
            timestamp: 0,
            posts: []
        }
    }
    return state
}

function saveState(state, file = './state.json') {
    fs.writeFileSync(file, JSON.stringify(state, undefined, 4), { encoding: 'utf8' })
}

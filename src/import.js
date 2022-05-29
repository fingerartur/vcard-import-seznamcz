const req = async lib => (await import(lib)).default

const fs = await req('fs')
const crypto = await req('crypto')
import nodeFetch from 'node-fetch'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

/**
 * @type VcardItem
 *   VcardItem.id - string unique ID
 *   VcardItem.text - text in text/vcard format
 *
 * @type UploadOptions
 *   UploadOptions.batchSize - number how many contacts per batch (recommended less than 1000)
 *   UploadOptions.batchTimeoutSec - number of seconds to wait between batches
 *   UploadOptions.startIndex - number index of contact to start from (beginning at 0)
 *
 *
 * @type Credentials
 *   Credentials.email - string
 *   Credentials.password - string
 */

/**
 * Wait for a few seconds
 *
 * @param {number} sec - number of seconds to wait
 */
const wait = (sec) => {
  return new Promise(resolve => {
    console.info(`Waiting for ${sec} seconds...`)

    setTimeout(resolve, sec * 1000)
  })
}

/**
 * Parse VCard contacts from a file
 *
 * @param {string} - filename .vcf file filename
 * @returns {string[]} of Vcard contacts in VCARD standard text/vcard format
 */
const _parseVcardContacts = (filename) => {
  const TOKEN_END_VCARD = 'END:VCARD'

  const buffer = fs.readFileSync(filename)
  const contactsText = buffer.toString()

  const contacts = contactsText
    .split(TOKEN_END_VCARD)
    .map(partialText => partialText + TOKEN_END_VCARD)

  return contacts
}

/**
 * @param {string} text
 * @returns {string} hashed text
 */
const hashText = (text) => {
  const hash = crypto.createHash('md5')
    .update(text)
    .digest('hex')

  return `artyimport=${hash}`.replace('=', '-')
}

/**
 * @param {string} filename - .vcf file filename
 * @returns {VcardItem[]} of Vcard contacts in VCARD standard text/vcard format
 */
const parseVcardContacts = (filename) => {
  console.info(`Processing ${filename}...`)

  const contacts = _parseVcardContacts(filename)

  console.info(`Found ${contacts.length} contacts in ${filename}`)

  const hashes = new Set()

  const result = contacts.map(item => {
    const id = hashText(item)

    if (hashes.has(id)) {
      throw new Error("Hash collision occurred")
    }

    hashes.add(id)

    return {
      id,
      text: item,
    }
  })

  return result
}

const base64 = (text) => {
  return Buffer.from(text).toString('base64')
}

/**
 * Imports one Vcard contact to Email.cz via its API
 *
 * @param {VcardItem} item - Vcard item
 * @param {Credentials} credentials - authentication credentials
 * @param {number} index - order number of this upload
 * @param {number} count - total count of all contacts to upload
 *
 * @throws when upload request failed
 */
const importContact = async (item, credentials, index, count) => {
  const { id, text } = item
  const { email, password } = credentials

  const url = `https://carddav.seznam.cz/${email}/ab/personal/${id}.vcf`
  const params = {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/vcard',
      // TODO for utf 8 use buffer https://stackoverflow.com/questions/43842793/basic-authentication-with-fetch
      'Authorization': `Basic ${base64(`${email}:${password}`)}`,
    },
    body: text,
  }

  const orderNumber = index + 1

  console.info(`Uploading ${orderNumber}/${count}... \n\n URL ${url} \n Data ${JSON.stringify(params)}`)

  try {
    const response = await nodeFetch(url, params)

    if (response.status !== 201) {
      console.warn(`HTTP error ${response.status} ${response.statusText}, ${JSON.stringify(response)}`)
      throw new Error('Response is not 201')
    }
  } catch (error) {
    console.error(`Failed at contact #${orderNumber}`)
    throw error
  }
}

/**
 * Imports Vcard contacts to Email.cz
 *
 * @param {VcardItem[]} items - array of VCard contacts
 * @param {Credentials} credentials - authentication credentials
 * @param {UploadOptions} options - upload options
 */
const importVcardContacts = async (items, credentials, options) => {
  const { batchSize, batchTimeoutSec, startIndex } = options
  let count = 0

  for (let i = startIndex; i < items.length; i++) {
    if (count === batchSize) {
      await wait(batchTimeoutSec)
      count = 0
    }

    await importContact(items[i], credentials, i, items.length)
    count++
  }
}

const main = async () => {
  const args = yargs(hideBin(process.argv))
    .option('email', {
      alias: 'e',
      type: 'string',
      description: 'Email address for Seznam Profi',
      demandOption: true,
    })
    .option('password', {
      alias: 'p',
      type: 'string',
      description: 'Password for Seznam Profi',
      demandOption: true,
    })
    .option('file', {
      alias: 'f',
      type: 'string',
      description: '.vcf file to be imported',
      demandOption: true,
    })
    .parse()

  const contacts = parseVcardContacts(args.file)
  const contactsWithEmail = contacts.filter(item => item.text.includes('EMAIL'))

  console.info(`Only contacts that have email will be imported (${contactsWithEmail.length}/${contacts.length})`)

  await importVcardContacts(contacts, args, { batchSize: 1000, batchTimeoutSec: 0, startIndex: 0 })

  console.info('All done')
}

main()

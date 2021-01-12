import AnyLogger from 'anylogger'
import crypto from 'crypto'
import { createReadStream, createWriteStream, mkdirSync as mkdir } from 'fs'
import { RequestInit } from 'node-fetch'
import { basename, dirname } from 'path'
import stream from 'stream'
import { promisify } from 'util'

import { fetch } from './fetch'


const log = AnyLogger('nginx-binaries')
const streamPipeline = promisify(stream.pipeline)

export async function downloadFile (
  url: string,
  checksum: string,
  filepath: string,
  fetchOpts?: RequestInit,
): Promise<string> {

  if (await checkFileChecksum(filepath, checksum)) {
    log.debug(`File ${filepath} already exists`)
    return filepath
  }

  const [hashAlg, expectedHash] = splitChecksumValue(checksum)
  const hash = crypto.createHash(hashAlg)

  log.info(`Downloading ${url}...`)

  mkdir(dirname(filepath), { recursive: true })

  const resp = await fetch(url, fetchOpts)

  await streamPipeline(
    resp.body.on('data', chunk => hash.update(chunk)),
    createWriteStream(filepath, { flags: 'w', mode: 0o0755 }),
  )

  if (hash.digest('hex') !== expectedHash) {
    throw Error(`File ${basename(filepath)} is corrupted, ${hashAlg} checksum doesn't match!`)
  }
  log.debug(`File was saved in ${filepath}`)

  return filepath
}

async function checkFileChecksum (filepath: string, checksum: string): Promise<boolean> {
  const [hashAlg, expectedHash] = splitChecksumValue(checksum)
  const hash = crypto.createHash(hashAlg)

  try {
    await streamPipeline(createReadStream(filepath), hash)
    return hash.digest('hex') === expectedHash

  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') {
      return false
    }
    throw err
  }
}

function splitChecksumValue (checksum: string): [algorithm: string, value: string] {
  const [alg, value] = checksum.split(':', 2)
  if (!alg || !value) {
    throw RangeError(`Invalid checksum value: ${checksum}`)
  }
  return [alg, value]
}
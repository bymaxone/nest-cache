/**
 * A throwaway self-signed certificate and its key, for the specs that open a real TLS server.
 *
 * Layer: server. `openssl` writes them into a directory of its own that is removed before this returns,
 * so nothing is left behind and no key is committed. The two files are named explicitly: `/dev/stdout`
 * and `/dev/stderr` are sockets under a child process of Node and OpenSSL 3 cannot open them.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A PEM certificate and its PEM private key. */
export interface ISelfSignedCertificate {
  readonly certificate: string
  readonly key: string
}

/**
 * Makes a certificate for `localhost` and `127.0.0.1`, valid for two days.
 *
 * @returns The certificate and the key, as PEM text.
 */
export function selfSignedCertificate(): ISelfSignedCertificate {
  const dir = mkdtempSync(join(tmpdir(), 'bymax-cache-cert-'))
  const keyFile = join(dir, 'key.pem')
  const certFile = join(dir, 'cert.pem')
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '2',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
        '-keyout',
        keyFile,
        '-out',
        certFile
      ],
      { stdio: 'ignore' }
    )
    return { certificate: readFileSync(certFile, 'utf8'), key: readFileSync(keyFile, 'utf8') }
  } finally {
    rmSync(keyFile, { force: true })
    rmSync(certFile, { force: true })
    rmdirSync(dir)
  }
}

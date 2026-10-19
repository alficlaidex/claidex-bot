/**
 * Claide Bot by Alfi
 * Backward-compatible YouTube adapter backed by the local search/download engine.
 */
import { searchYouTube, downloadYouTube } from '../lib/youtube.js'

export const jhydl = Object.freeze({
  search: searchYouTube,
  async download(url, format = 'mp3') {
    const result = await downloadYouTube(url, format)
    return {
      title: result.title,
      duration: result.duration,
      download_url: result.downloadUrl,
      thumbnail: result.thumb,
    }
  },
})

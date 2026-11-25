// The API every renderer module uses: the preload's, with project calls routed to the owning machine.
import { createRoutedApi } from './remote/routed-api'
import { report } from './notice'

// window.open is turned into the system browser by the main process; what a merged answer leaves out goes to the Notice
export const api = createRoutedApi(window.brandy, url => { window.open(url, '_blank') }, report)

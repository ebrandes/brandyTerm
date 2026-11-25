// The API every renderer module uses: the preload's, with project calls routed to the owning machine.
import { createRoutedApi } from './remote/routed-api'

export const api = createRoutedApi(window.brandy)

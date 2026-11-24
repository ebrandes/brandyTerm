/// <reference types="vite/client" />
import type { BrandyApi } from '../../shared/api.ts'

declare global {
  interface Window {
    brandy: BrandyApi
  }
}
export {}

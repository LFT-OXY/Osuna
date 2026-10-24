/** A text file the user keeps: saved where they pick, downloaded, or shared. */
export interface SaveTextFileInput {
  fileName: string;
  contents: string;
  mimeType: string;
  /** The iOS share sheet's type, e.g. `public.comma-separated-values-text`. */
  uti: string;
  /** The save dialog's filter: its label and the extension without the dot. */
  filterName: string;
  extension: string;
}

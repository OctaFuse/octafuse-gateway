/**
 * Next `build:docker` treats these as static assets; `tsc` does not.
 * Keep this shim so `npm run typecheck:admin` matches the Docker typecheck surface.
 */
declare module '*.svg' {
	const src: string | { src: string };
	export default src;
}

declare module '@lobehub/icons-static-svg/icons/*.svg' {
	const src: string | { src: string };
	export default src;
}

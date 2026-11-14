// A centred column of the given max width. A div, not <main>: the app shell
// already wraps every page in the one <main> landmark.
function Page({ width = 900, children }) {
  return (
    <div className="page">
      <div className="page__inner" style={{ "--page-width": `${width}px` }}>
        {children}
      </div>
    </div>
  );
}

export default Page;

// Full-height dark page with a centred column of the given max width.
function Page({ width = 900, children }) {
  return (
    <main className="page">
      <div className="page__inner" style={{ "--page-width": `${width}px` }}>
        {children}
      </div>
    </main>
  );
}

export default Page;

/* eslint-disable @next/next/no-img-element */

export default function Test() {
  return (
    <div className="bg-slate-50">
      <div className="flex-center flex h-screen">
        <div className="bg-grid-blue-100 rounded-xl  bg-white">
          <div className="flex-center flex h-48 w-80 rounded-xl border bg-gradient-to-br from-transparent via-white to-white p-4 shadow-sm">
            <img
              height="100"
              width="100"
              src="https://i.imgflip.com/6td9n5.jpg?a468936"
              alt="cat"
              className="rounded-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

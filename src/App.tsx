/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';

const Analysis = lazy(() => import('./pages/Analysis'));

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path="/analyze/:owner/:repo"
          element={
            <Suspense fallback={<div className="p-6 text-slate-500">Loading...</div>}>
              <Analysis />
            </Suspense>
          }
        />
        <Route
          path="/analyze/local"
          element={
            <Suspense fallback={<div className="p-6 text-slate-500">Loading...</div>}>
              <Analysis />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

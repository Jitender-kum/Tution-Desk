import { Suspense } from "react";
import StudentProfile from "@/components/students/StudentProfile";

interface PageProps {
  params: Promise<{ studentId: string }>;
}

async function StudentProfileContent({
  paramsPromise,
}: {
  paramsPromise: Promise<{ studentId: string }>;
}) {
  const { studentId } = await paramsPromise;
  return <StudentProfile studentId={studentId} />;
}

export default function StudentProfilePage({ params }: PageProps) {
  return (
    <div className="w-full max-w-full overflow-x-hidden">
      <Suspense
        fallback={
          <div className="p-8 text-center animate-pulse text-gray-500">
            Loading student profile...
          </div>
        }
      >
        <StudentProfileContent paramsPromise={params} />
      </Suspense>
    </div>
  );
}

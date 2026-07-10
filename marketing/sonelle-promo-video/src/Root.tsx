import "./index.css";
import { Composition } from "remotion";
import { SonelleProductFilm } from "./SonelleProductFilm";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SonelleProductFilm"
        component={SonelleProductFilm}
        durationInFrames={1728}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
